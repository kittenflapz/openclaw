import { describe, expect, it } from "vitest";
import { resolveThreadSessionKeys } from "../../routing/session-key.js";

/**
 * Tests for Discord thread session isolation functionality.
 */

// Helper to simulate resolveDiscordThreadConfig behavior
function resolveDiscordThreadConfig(params: {
  channelConfig?: { thread?: { isolate?: boolean; inheritMessages?: number } };
  guildConfig?: { threadDefaults?: { isolate?: boolean; inheritMessages?: number } };
  accountConfig?: { threadDefaults?: { isolate?: boolean; inheritMessages?: number } };
}): { isolate: boolean; inheritMessages: number } {
  const channelThread = params.channelConfig?.thread;
  const guildThread = params.guildConfig?.threadDefaults;
  const accountThread = params.accountConfig?.threadDefaults;

  return {
    isolate: channelThread?.isolate ?? guildThread?.isolate ?? accountThread?.isolate ?? true,
    inheritMessages:
      channelThread?.inheritMessages ??
      guildThread?.inheritMessages ??
      accountThread?.inheritMessages ??
      0,
  };
}

describe("resolveDiscordThreadConfig", () => {
  describe("config cascade priority", () => {
    it("uses default values when no config provided", () => {
      const result = resolveDiscordThreadConfig({});
      expect(result).toEqual({
        isolate: true,
        inheritMessages: 0,
      });
    });

    it("uses account-level config when only account is set", () => {
      const result = resolveDiscordThreadConfig({
        accountConfig: { threadDefaults: { isolate: false, inheritMessages: 10 } },
      });
      expect(result).toEqual({
        isolate: false,
        inheritMessages: 10,
      });
    });

    it("uses guild-level config over account-level", () => {
      const result = resolveDiscordThreadConfig({
        guildConfig: { threadDefaults: { isolate: true, inheritMessages: 5 } },
        accountConfig: { threadDefaults: { isolate: false, inheritMessages: 10 } },
      });
      expect(result).toEqual({
        isolate: true,
        inheritMessages: 5,
      });
    });

    it("uses channel-level config over guild and account", () => {
      const result = resolveDiscordThreadConfig({
        channelConfig: { thread: { isolate: false, inheritMessages: 3 } },
        guildConfig: { threadDefaults: { isolate: true, inheritMessages: 5 } },
        accountConfig: { threadDefaults: { isolate: true, inheritMessages: 10 } },
      });
      expect(result).toEqual({
        isolate: false,
        inheritMessages: 3,
      });
    });

    it("merges partial configs (isolate from channel, inheritMessages from guild)", () => {
      const result = resolveDiscordThreadConfig({
        channelConfig: { thread: { isolate: false } },
        guildConfig: { threadDefaults: { inheritMessages: 7 } },
        accountConfig: { threadDefaults: { isolate: true, inheritMessages: 10 } },
      });
      expect(result).toEqual({
        isolate: false, // from channel
        inheritMessages: 7, // from guild (channel didn't specify)
      });
    });

    it("handles undefined intermediate levels", () => {
      const result = resolveDiscordThreadConfig({
        channelConfig: undefined,
        guildConfig: undefined,
        accountConfig: { threadDefaults: { inheritMessages: 15 } },
      });
      expect(result).toEqual({
        isolate: true, // default
        inheritMessages: 15, // from account
      });
    });
  });

  describe("edge cases", () => {
    it("handles empty thread objects", () => {
      const result = resolveDiscordThreadConfig({
        channelConfig: { thread: {} },
        guildConfig: { threadDefaults: {} },
        accountConfig: { threadDefaults: {} },
      });
      expect(result).toEqual({
        isolate: true,
        inheritMessages: 0,
      });
    });

    it("respects explicit false for isolate", () => {
      const result = resolveDiscordThreadConfig({
        channelConfig: { thread: { isolate: false } },
      });
      expect(result.isolate).toBe(false);
    });

    it("respects explicit 0 for inheritMessages", () => {
      const result = resolveDiscordThreadConfig({
        channelConfig: { thread: { inheritMessages: 0 } },
        accountConfig: { threadDefaults: { inheritMessages: 5 } },
      });
      expect(result.inheritMessages).toBe(0);
    });
  });
});

describe("resolveThreadSessionKeys", () => {
  const baseSessionKey = "agent:main:discord:channel:123456789";
  const parentSessionKey = "agent:main:discord:channel:987654321";

  describe("thread isolation", () => {
    it("appends thread suffix when useSuffix is true and threadId provided", () => {
      const result = resolveThreadSessionKeys({
        baseSessionKey,
        threadId: "111222333",
        parentSessionKey,
        useSuffix: true,
      });
      expect(result.sessionKey).toBe(`${baseSessionKey}:thread:111222333`);
      expect(result.parentSessionKey).toBe(parentSessionKey);
    });

    it("uses base session key when useSuffix is false", () => {
      const result = resolveThreadSessionKeys({
        baseSessionKey,
        threadId: "111222333",
        parentSessionKey,
        useSuffix: false,
      });
      expect(result.sessionKey).toBe(baseSessionKey);
      expect(result.parentSessionKey).toBe(parentSessionKey);
    });

    it("uses base session key when no threadId provided (not in thread)", () => {
      const result = resolveThreadSessionKeys({
        baseSessionKey,
        threadId: undefined,
        parentSessionKey,
        useSuffix: true,
      });
      expect(result.sessionKey).toBe(baseSessionKey);
      expect(result.parentSessionKey).toBeUndefined();
    });

    it("normalizes thread ID to lowercase", () => {
      const result = resolveThreadSessionKeys({
        baseSessionKey,
        threadId: "ABC123DEF",
        parentSessionKey,
        useSuffix: true,
      });
      expect(result.sessionKey).toBe(`${baseSessionKey}:thread:abc123def`);
    });
  });

  describe("archived thread resumption", () => {
    it("generates consistent session key for same thread ID (supports archive/unarchive)", () => {
      const threadId = "archived-thread-123";

      // First access (before archive)
      const result1 = resolveThreadSessionKeys({
        baseSessionKey,
        threadId,
        parentSessionKey,
        useSuffix: true,
      });

      // Second access (after unarchive) - should be identical
      const result2 = resolveThreadSessionKeys({
        baseSessionKey,
        threadId,
        parentSessionKey,
        useSuffix: true,
      });

      expect(result1.sessionKey).toBe(result2.sessionKey);
    });
  });
});

describe("thread isolation integration", () => {
  it("isolates threads by default (breaking change behavior)", () => {
    const config = resolveDiscordThreadConfig({});
    const isInThread = true;

    // Simulate the useSuffix calculation from message-handler.process.ts
    const useSuffix = config.isolate && isInThread;

    expect(useSuffix).toBe(true);
  });

  it("shares session when isolate is explicitly false", () => {
    const config = resolveDiscordThreadConfig({
      channelConfig: { thread: { isolate: false } },
    });
    const isInThread = true;

    const useSuffix = config.isolate && isInThread;

    expect(useSuffix).toBe(false);
  });

  it("does not isolate non-thread channels regardless of config", () => {
    const config = resolveDiscordThreadConfig({
      channelConfig: { thread: { isolate: true } },
    });
    const isInThread = false;

    const useSuffix = config.isolate && isInThread;

    expect(useSuffix).toBe(false);
  });
});
