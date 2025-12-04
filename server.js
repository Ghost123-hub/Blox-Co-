// ==========================================
//  BLOX & CO SECURITY BOT v6
//  - Softban + Hardware Ban
//  - Lookup Command
//  - Full Command Logging
//  - Staff Role-Gated Slash Commands
//  - Anti-Raid, Anti-Nuke, Webhook Defense
//  - Message Security & Trust System
//  - Auto-Fix (Backups) & Staff Action Logs
// ==========================================

const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("✅ Security Bot is alive."));
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Keepalive server running")
);

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  REST,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  AuditLogEvent
} = require("discord.js");

require("dotenv").config();
const fs = require("fs");

// ---------- CLIENT ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.MessageContent
  ]
});

// ---------- CONFIG ----------
const GUILD_ID = "1381002127765278740";
const OWNER_ID = "1350882351743500409";

const STAFF_ROLES = [
  "1397546010317684786",
  "1381268185671667732",
  "1381268072828112896",
  "1381268070248484944"
];

const LOG_CHANNEL_ID = "1439268049806168194";

// ---------- SECURITY CONFIG ----------
const SECURITY_CONFIG = {
  logChannelId: LOG_CHANNEL_ID,

  // Permissions that should NEVER suddenly appear on roles
  dangerousPerms: [
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageWebhooks,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.KickMembers
  ],

  // Raid & alt detection
  raid: {
    joinWindowMs: 10_000, // 10 seconds
    joinThreshold: 6,     // 6 joins in 10s triggers raid
    autoLock: true,
    autoUnlockMs: 5 * 60 * 1000, // 5 minutes
    lockdownSlowmodeSeconds: 10
  },

  minAccountAgeMs: 3 * 24 * 60 * 60 * 1000, // 3 days minimum account age

  // Webhook defense
  maxWebhooksPerChannel: 3,
  webhookWhitelistIds: [], // add safe webhook IDs here if needed

  // Message security
  spam: {
    windowMs: 7_000,  // spam window
    maxMessages: 6    // messages in window
  },
  massMention: {
    maxMentions: 6
  },
  trust: {
    lowTrustThreshold: -30,
    timeoutMs: 60 * 60 * 1000 // 1 hour
  }
};

// ---------- FILES ----------
const SOFTBAN_FILE = "./softbans.json";
const HARDWARE_BAN_FILE = "./hardwarebans.json";

let softbannedUsers = new Set();
let hardwareBans = [];

// Load stored softbans
if (fs.existsSync(SOFTBAN_FILE)) {
  softbannedUsers = new Set(JSON.parse(fs.readFileSync(SOFTBAN_FILE)));
} else {
  fs.writeFileSync(SOFTBAN_FILE, JSON.stringify([]));
}

// Load stored hardware bans
if (fs.existsSync(HARDWARE_BAN_FILE)) {
  hardwareBans = JSON.parse(fs.readFileSync(HARDWARE_BAN_FILE));
} else {
  fs.writeFileSync(HARDWARE_BAN_FILE, JSON.stringify([]));
}

function saveSoftbans() {
  fs.writeFileSync(SOFTBAN_FILE, JSON.stringify([...softbannedUsers], null, 2));
}

function saveHardwareBans() {
  fs.writeFileSync(HARDWARE_BAN_FILE, JSON.stringify(hardwareBans, null, 2));
}

// ---------- PERMISSION CHECK ----------
function hasPermission(member) {
  if (!member) return false;
  if (member.id === OWNER_ID) return true;
  return member.roles.cache.some((r) => STAFF_ROLES.includes(r.id));
}

// ---------- SECURITY STATE ----------
const joinHistory = new Map();      // guildId -> [timestamps]
const raidLockdowns = new Map();    // guildId -> boolean
const messageHistory = new Map();   // userId -> [timestamps]
const trustScores = new Map();      // userId -> score
const backups = {
  roles: new Map(),     // guildId -> roleSnapshots[]
  channels: new Map()   // guildId -> channelSnapshots[]
};

function getLogChannel(guild) {
  return guild.channels.cache.get(LOG_CHANNEL_ID) || null;
}

function adjustTrust(userId, delta) {
  const old = trustScores.get(userId) || 0;
  const next = old + delta;
  trustScores.set(userId, next);
  return next;
}

function getTrust(userId) {
  return trustScores.get(userId) || 0;
}

// ---------- BACKUP & AUTO-FIX ----------
async function backupGuildStructure(guild) {
  try {
    const rolesData = guild.roles.cache.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      position: r.position,
      permissions: r.permissions.bitfield,
      mentionable: r.mentionable
    }));
    backups.roles.set(guild.id, rolesData);

    const channelsData = guild.channels.cache.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parentId: c.parentId,
      position: c.position
    }));
    backups.channels.set(guild.id, channelsData);

    console.log(`🔁 Backup updated for ${guild.name}: ${rolesData.length} roles, ${channelsData.length} channels.`);
  } catch (err) {
    console.error(`Backup error for guild ${guild.id}:`, err);
  }
}

async function autoFixChannelDelete(channel) {
  const guild = channel.guild;
  const logChannel = getLogChannel(guild);
  const channelBackup = backups.channels.get(guild.id) || [];
  const snapshot = channelBackup.find((c) => c.id === channel.id);

  if (!snapshot) {
    logChannel?.send(`⚠️ Channel **#${channel.name}** (${channel.id}) deleted, but no backup snapshot found.`);
    return;
  }

  try {
    const newChannel = await guild.channels.create({
      name: snapshot.name,
      type: snapshot.type,
      parent: snapshot.parentId || null,
      position: snapshot.position
    });

    logChannel?.send(
      `🛠️ **Channel Auto-Recreated**\n` +
      `Old: #${channel.name} (${channel.id})\n` +
      `New: <#${newChannel.id}> (${newChannel.id})`
    );
  } catch (err) {
    console.error("Auto-fix channel error:", err);
    logChannel?.send(
      `❌ Failed to auto-recreate channel **#${channel.name}**. Check bot permissions.`
    );
  }
}

async function autoFixRoleDelete(role) {
  const guild = role.guild;
  const logChannel = getLogChannel(guild);
  const roleBackup = backups.roles.get(guild.id) || [];
  const snapshot = roleBackup.find((r) => r.id === role.id);

  if (!snapshot) {
    logChannel?.send(`⚠️ Role **${role.name}** (${role.id}) deleted, but no backup snapshot found.`);
    return;
  }

  try {
    const newRole = await guild.roles.create({
      name: snapshot.name,
      color: snapshot.color,
      hoist: snapshot.hoist,
      permissions: snapshot.permissions,
      mentionable: snapshot.mentionable
    });

    await newRole.setPosition(snapshot.position).catch(() => null);

    logChannel?.send(
      `🛠️ **Role Auto-Recreated**\n` +
      `Old: ${role.name} (${role.id})\n` +
      `New: ${newRole.name} (${newRole.id})`
    );
  } catch (err) {
    console.error("Auto-fix role error:", err);
    logChannel?.send(
      `❌ Failed to auto-recreate role **${role.name}**. Check bot permissions.`
    );
  }
}

// ---------- RAID & ALT DETECTION ----------
async function handleJoinSecurity(member) {
  const guild = member.guild;
  const logChannel = getLogChannel(guild);
  const now = Date.now();

  // Track joins for raid detection
  let arr = joinHistory.get(guild.id) || [];
  arr.push(now);
  arr = arr.filter((t) => now - t <= SECURITY_CONFIG.raid.joinWindowMs);
  joinHistory.set(guild.id, arr);

  // Alt detection (account age)
  const accountAge = now - member.user.createdTimestamp;
  const isAlt = accountAge < SECURITY_CONFIG.minAccountAgeMs;

  if (isAlt) {
    const newTrust = adjustTrust(member.id, -20);
    logChannel?.send(
      `⚠️ **Possible Alt Detected**\n` +
      `User: ${member.user.tag} (\`${member.id}\`)\n` +
      `Account age: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n` +
      `Trust score: **${newTrust}**`
    );
  } else {
    adjustTrust(member.id, 5);
  }

  // Raid detection
  if (
    arr.length >= SECURITY_CONFIG.raid.joinThreshold &&
    !raidLockdowns.get(guild.id)
  ) {
    raidLockdowns.set(guild.id, true);

    logChannel?.send(
      `🚨 **RAID DETECTED**\n` +
      `Joins in last ${SECURITY_CONFIG.raid.joinWindowMs / 1000}s: **${arr.length}**\n` +
      `Lockdown enabled.`
    );

    if (SECURITY_CONFIG.raid.autoLock) {
      const everyone = guild.roles.everyone;

      for (const [, channel] of guild.channels.cache) {
        if (!channel.manageable) continue;
        if (!channel.isTextBased()) continue;

        try {
          await channel.permissionOverwrites.edit(everyone, {
            SendMessages: false
          });
          if (channel.type === ChannelType.GuildText) {
            await channel.setRateLimitPerUser(
              SECURITY_CONFIG.raid.lockdownSlowmodeSeconds
            );
          }
        } catch {
          // ignore individual failures
        }
      }

      if (SECURITY_CONFIG.raid.autoUnlockMs > 0) {
        setTimeout(async () => {
          const stillLocked = raidLockdowns.get(guild.id);
          if (!stillLocked) return;

          raidLockdowns.set(guild.id, false);
          for (const [, channel] of guild.channels.cache) {
            if (!channel.manageable) continue;
            if (!channel.isTextBased()) continue;

            try {
              await channel.permissionOverwrites.edit(guild.roles.everyone, {
                SendMessages: null // reset to default
              });
              if (channel.type === ChannelType.GuildText) {
                await channel.setRateLimitPerUser(0);
              }
            } catch {
              // ignore
            }
          }

          logChannel?.send(`✅ **Raid Lockdown Automatically Lifted.**`);
        }, SECURITY_CONFIG.raid.autoUnlockMs);
      }
    }
  }
}

// ---------- MESSAGE SECURITY LAYER ----------
async function handleMessageSecurity(message) {
  if (!message.guild) return;
  if (message.author.bot) return;

  const guild = message.guild;
  const member = message.member;
  const logChannel = getLogChannel(guild);
  const contentLower = message.content.toLowerCase();
  const now = Date.now();

  // Track per-user message timestamps
  let arr = messageHistory.get(message.author.id) || [];
  arr.push(now);
  arr = arr.filter((t) => now - t <= SECURITY_CONFIG.spam.windowMs);
  messageHistory.set(message.author.id, arr);

  let triggers = [];

  // Spam
  if (arr.length >= SECURITY_CONFIG.spam.maxMessages) {
    triggers.push("Rapid messaging / spam");
  }

  // Mass mention
  const mentionCount =
    message.mentions.users.size +
    message.mentions.roles.size +
    (message.mentions.everyone ? 1 : 0);
  if (mentionCount >= SECURITY_CONFIG.massMention.maxMentions) {
    triggers.push("Mass mentions");
  }

  // Invite links from non-staff
  const hasInvite = /discord\.gg\/|discord\.com\/invite/i.test(message.content);
  if (hasInvite && !hasPermission(member)) {
    triggers.push("Untrusted invite link");
  }

  // Very basic scam / phishing keyword checks
  const suspiciousPhrases = ["free nitro", "airdrop", "steamcommunity", "gift nitro"];
  if (suspiciousPhrases.some((p) => contentLower.includes(p))) {
    triggers.push("Suspicious / scam phrase");
  }

  if (triggers.length === 0) return;

  // Action
  try {
    await message.delete().catch(() => {});
  } catch {
    // ignore
  }

  const newTrust = adjustTrust(message.author.id, -10);

  const embed = new EmbedBuilder()
    .setTitle("🛡️ Message Blocked")
    .setColor(0xffc107)
    .setDescription(
      [
        `**User:** ${message.author.tag} (\`${message.author.id}\`)`,
        `**Triggered:** ${triggers.join(", ")}`,
        `**Trust score:** ${newTrust}`,
        `**Channel:** ${message.channel} (\`${message.channel.id}\`)`,
        "",
        "Content:",
        "```" + message.content.slice(0, 400) + "```"
      ].join("\n")
    )
    .setTimestamp();

  logChannel?.send({ embeds: [embed] });

  // Low-trust auto-timeout
  if (newTrust <= SECURITY_CONFIG.trust.lowTrustThreshold && member && member.moderatable) {
    try {
      await member.timeout(
        SECURITY_CONFIG.trust.timeoutMs,
        "Automatic security timeout (low trust)"
      );
      logChannel?.send(
        `⏳ **User Timed Out**\n` +
        `User: ${message.author.tag} (\`${message.author.id}\`)\n` +
        `Reason: Low trust after repeated security triggers.`
      );
    } catch {
      // ignore if can't timeout
    }
  }
}

// ---------- ANTI-NUKE & PERMISSION PROTECTION ----------
async function handleRoleUpdate(oldRole, newRole) {
  const guild = newRole.guild;
  const logChannel = getLogChannel(guild);

  const oldDanger = SECURITY_CONFIG.dangerousPerms.some((p) =>
    oldRole.permissions.has(p)
  );
  const newDanger = SECURITY_CONFIG.dangerousPerms.some((p) =>
    newRole.permissions.has(p)
  );

  // Role suddenly gets dangerous perms -> revert
  if (!oldDanger && newDanger) {
    try {
      await newRole.setPermissions(oldRole.permissions);
    } catch (err) {
      console.error("Failed to revert role permissions:", err);
    }

    logChannel?.send(
      `🚫 **Permission Escalation Blocked**\n` +
      `Role: ${newRole.name} (\`${newRole.id}\`)\n` +
      `Dangerous permissions were added and automatically reverted.`
    );
  }
}

// ---------- WEBHOOK DEFENSE ----------
async function handleWebhookUpdate(channel) {
  const guild = channel.guild;
  const logChannel = getLogChannel(guild);
  let webhooks;

  try {
    webhooks = await channel.fetchWebhooks();
  } catch {
    return;
  }

  if (!webhooks || webhooks.size === 0) return;

  // Clean up excess webhooks
  if (webhooks.size > SECURITY_CONFIG.maxWebhooksPerChannel) {
    let deletedCount = 0;

    for (const [, hook] of webhooks) {
      if (!SECURITY_CONFIG.webhookWhitelistIds.includes(hook.id)) {
        try {
          await hook.delete("Auto-cleanup: too many webhooks");
          deletedCount++;
        } catch {
          // ignore
        }
      }
    }

    if (deletedCount > 0) {
      logChannel?.send(
        `🧹 **Webhook Cleanup**\n` +
        `Channel: ${channel} (\`${channel.id}\`)\n` +
        `Removed **${deletedCount}** non-whitelisted webhooks.`
      );
    }
  }
}

// ---------- STAFF ACTION MONITORING ----------
async function getAuditExecutor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 1 });
    const entry = logs.entries.first();
    if (!entry) return null;
    if (targetId && entry.target && entry.target.id !== targetId) return null;
    return entry.executor;
  } catch {
    return null;
  }
}

// ---------- SLASH COMMAND DEFINITIONS ----------
const commands = [
  new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Softban a user (blocked from joining).")
    .addStringOption(o =>
      o.setName("userid").setDescription("User ID").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unsoftban")
    .setDescription("Remove a user from the softban list.")
    .addStringOption(o =>
      o.setName("userid").setDescription("User ID").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("softbanlist")
    .setDescription("Display all softbanned users."),

  new SlashCommandBuilder()
    .setName("hardwareban")
    .setDescription("Hardware-ban a user ID.")
    .addStringOption(o =>
      o.setName("userid").setDescription("User ID").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unhardwareban")
    .setDescription("Remove a hardware ban from a user.")
    .addStringOption(o =>
      o.setName("userid").setDescription("User ID").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("hardwarebanlist")
    .setDescription("Display all hardware bans."),

  new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Lookup a Discord user by ID.")
    .addStringOption(o =>
      o.setName("userid").setDescription("User ID to lookup").setRequired(true)
    ),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.SECURITY_BOT_TOKEN);

// ---------- READY ----------
client.on("ready", async () => {
  console.log(`🔒 Logged in as ${client.user.tag}`);

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );

  console.log("✅ Slash commands updated.");

  client.user.setPresence({
    activities: [{ name: "Blox & Co Security" }],
    status: "online"
  });

  // Initial backups + periodic backups
  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    await backupGuildStructure(guild);
  }
  setInterval(() => {
    const g = client.guilds.cache.get(GUILD_ID);
    if (g) backupGuildStructure(g);
  }, 10 * 60 * 1000); // every 10 minutes
});

// ---------- AUTO-KICK + RAID/ALT SECURITY ----------
client.on("guildMemberAdd", async (member) => {
  const log = member.guild.channels.cache.get(LOG_CHANNEL_ID);

  // Softban / hardware ban checks first
  if (softbannedUsers.has(member.id)) {
    await member.kick("Softbanned.");
    return log?.send(
      `🚫 **Softbanned user attempted to join:** ${member.user.tag} (\`${member.id}\`)`
    );
  }

  if (hardwareBans.includes(member.id)) {
    await member.kick("Hardware banned.");
    return log?.send(
      `🔨 **Hardware-Banned user attempted to join:** ${member.user.tag} (\`${member.id}\`)`
    );
  }

  // Advanced join security (raid + alt detection)
  await handleJoinSecurity(member);
});

// =============== FULL COMMAND LOGGING ===============
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, options } = interaction;
  const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);

  // Get argument list
  const args = [];
  options._hoistedOptions?.forEach(opt => {
    args.push(`${opt.name}: ${opt.value}`);
  });

  const argString = args.length > 0 ? args.join(", ") : "No arguments";

  // Log every attempt
  logChannel?.send(
    `📘 **Command Used**\n` +
    `**User:** ${member.user.tag} (\`${member.id}\`)\n` +
    `**Command:** /${commandName}\n` +
    `**Arguments:** ${argString}\n` +
    `**Timestamp:** <t:${Math.floor(Date.now() / 1000)}:F>`
  );

  // Permission check
  if (!hasPermission(member)) {
    logChannel?.send(
      `⚠️ **Permission Denied**\n` +
      `User: ${member.user.tag} attempted **/${commandName}**`
    );

    return interaction.reply({
      content: "❌ You do not have permission to use this command.",
      ephemeral: true,
    });
  }

  const userId = options.getString("userid");

  try {
    // ============================
    // COMMAND HANDLING
    // ============================

    // LOOKUP
    if (commandName === "lookup") {
      try {
        const user = await client.users.fetch(userId);

        const embed = new EmbedBuilder()
          .setTitle("🔍 User Lookup")
          .setColor("#2b2d31")
          .addFields(
            { name: "Tag", value: user.tag, inline: true },
            { name: "ID", value: user.id, inline: true }
          )
          .setThumbnail(user.displayAvatarURL());

        interaction.reply({ embeds: [embed], ephemeral: true });

        logChannel?.send(
          `🟢 **Lookup Success**\nTarget: ${user.tag} (\`${user.id}\`)\nStaff: ${member.user.tag}`
        );

      } catch (err) {
        interaction.reply({
          content: "❌ Invalid user ID.",
          ephemeral: true,
        });

        logChannel?.send(
          `🔴 **Lookup Failed**\nUser ID: \`${userId}\`\nReason: Invalid ID`
        );
      }
      return;
    }

    // SOFTBAN
    if (commandName === "softban") {
      softbannedUsers.add(userId);
      saveSoftbans();
      interaction.reply({ content: `🔒 Softbanned **${userId}**.`, ephemeral: true });

      logChannel?.send(
        `🟥 **Softban Added**\nUser ID: \`${userId}\`\nStaff: ${member.user.tag}`
      );
      return;
    }

    // UNSOFTBAN
    if (commandName === "unsoftban") {
      if (!softbannedUsers.has(userId)) {
        interaction.reply({ content: "⚠️ User is not softbanned.", ephemeral: true });

        logChannel?.send(
          `🔸 **Unsoftban Failed** — Not Banned\nUser: \`${userId}\``
        );
        return;
      }

      softbannedUsers.delete(userId);
      saveSoftbans();
      interaction.reply({ content: `🔓 Softban removed for **${userId}**.`, ephemeral: true });

      logChannel?.send(
        `🟩 **Softban Removed**\nUser: \`${userId}\`\nStaff: ${member.user.tag}`
      );
      return;
    }

    // SOFTBAN LIST
    if (commandName === "softbanlist") {
      const list = [...softbannedUsers];

      interaction.reply({
        content:
          list.length === 0
            ? "📜 No softbanned users."
            : `📜 Softbanned Users:\n${list.map(id => `• \`${id}\``).join("\n")}`,
        ephemeral: true
      });

      logChannel?.send(`📄 **Softban List Viewed** by ${member.user.tag}`);
      return;
    }

    // HARDWAREBAN
    if (commandName === "hardwareban") {
      if (hardwareBans.includes(userId)) {
        interaction.reply({ content: "⚠️ Already hardware banned.", ephemeral: true });

        logChannel?.send(
          `🔸 **Hardware Ban Failed** — Already Banned\nUser: \`${userId}\``
        );
        return;
      }

      hardwareBans.push(userId);
      saveHardwareBans();
      interaction.reply({ content: `🔨 Hardware banned **${userId}**.`, ephemeral: true });

      logChannel?.send(
        `🟥 **Hardware Ban Added**\nUser: \`${userId}\`\nStaff: ${member.user.tag}`
      );
      return;
    }

    // UNHARDWAREBAN
    if (commandName === "unhardwareban") {
      if (!hardwareBans.includes(userId)) {
        interaction.reply({ content: "⚠️ User is not hardware banned.", ephemeral: true });

        logChannel?.send(
          `🔸 **Unhardwareban Failed** — Not Banned\nUser: \`${userId}\``
        );
        return;
      }

      hardwareBans = hardwareBans.filter((id) => id !== userId);
      saveHardwareBans();

      interaction.reply({ content: `🔓 Hardware ban removed for **${userId}**.`, ephemeral: true });

      logChannel?.send(
        `🟩 **Hardware Ban Removed**\nUser: \`${userId}\`\nStaff: ${member.user.tag}`
      );
      return;
    }

    // HARDWAREBAN LIST
    if (commandName === "hardwarebanlist") {
      interaction.reply({
        content:
          hardwareBans.length === 0
            ? "📜 No hardware bans."
            : `📜 Hardware Bans:\n${hardwareBans.map(id => `• \`${id}\``).join("\n")}`,
        ephemeral: true
      });

      logChannel?.send(
        `📄 **Hardware Ban List Viewed** by ${member.user.tag}`
      );
      return;
    }

  } catch (err) {
    console.error("❌ Error:", err);

    logChannel?.send(
      `🔴 **Command Error**\n` +
      `Command: /${commandName}\n` +
      `User: ${member.user.tag} (\`${member.id}\`)\n` +
      `Error: \`${err.message}\``
    );

    if (!interaction.replied) {
      interaction.reply({
        content: "❌ An unexpected error occurred.",
        ephemeral: true,
      });
    }
  }
});

// ---------- MESSAGE CREATE (SECURITY LAYER) ----------
client.on("messageCreate", async (message) => {
  await handleMessageSecurity(message);
});

// ---------- ROLE / CHANNEL / WEBHOOK / BAN LOGGING ----------
client.on("roleUpdate", (oldRole, newRole) => {
  handleRoleUpdate(oldRole, newRole);
});

client.on("roleDelete", async (role) => {
  const guild = role.guild;
  const logChannel = getLogChannel(guild);
  const executor = await getAuditExecutor(guild, AuditLogEvent.RoleDelete, role.id);

  logChannel?.send(
    `⚠️ **Role Deleted**\n` +
    `Role: ${role.name} (\`${role.id}\`)\n` +
    `Executor: ${executor ? `${executor.tag} (\`${executor.id}\`)` : "Unknown"}`
  );

  await autoFixRoleDelete(role);
});

client.on("channelDelete", async (channel) => {
  const guild = channel.guild;
  const logChannel = getLogChannel(guild);
  const executor = await getAuditExecutor(guild, AuditLogEvent.ChannelDelete, channel.id);

  logChannel?.send(
    `⚠️ **Channel Deleted**\n` +
    `Channel: #${channel.name} (\`${channel.id}\`)\n` +
    `Executor: ${executor ? `${executor.tag} (\`${executor.id}\`)` : "Unknown"}`
  );

  await autoFixChannelDelete(channel);
});

client.on("webhooksUpdate", async (channel) => {
  await handleWebhookUpdate(channel);
});

client.on("guildBanAdd", async (ban) => {
  const guild = ban.guild;
  const logChannel = getLogChannel(guild);
  const executor = await getAuditExecutor(guild, AuditLogEvent.MemberBanAdd, ban.user.id);

  logChannel?.send(
    `🔨 **User Banned**\n` +
    `User: ${ban.user.tag} (\`${ban.user.id}\`)\n` +
    `Executor: ${executor ? `${executor.tag} (\`${executor.id}\`)` : "Unknown"}`
  );
});

client.on("guildBanRemove", async (ban) => {
  const guild = ban.guild;
  const logChannel = getLogChannel(guild);
  const executor = await getAuditExecutor(guild, AuditLogEvent.MemberBanRemove, ban.user.id);

  logChannel?.send(
    `♻️ **User Unbanned**\n` +
    `User: ${ban.user.tag} (\`${ban.user.id}\`)\n` +
    `Executor: ${executor ? `${executor.tag} (\`${executor.id}\`)` : "Unknown"}`
  );
});

// ---------- LOGIN ----------
client.login(process.env.SECURITY_BOT_TOKEN);
