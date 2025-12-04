// ==========================================
//  BLOX & CO SECURITY BOT v9
//  - Softban / Hardware Ban / Lookup
//  - Full Command Logging & Staff Gating
//  - Anti-Raid, Anti-Nuke, Webhook Defense
//  - Message Security & Trust System
//  - Auto-Fix (Backups) & Staff Action Logs
//  - Whitelist System
//  - Advanced Staff Commands:
//      /trustscore, /securitystatus,
//      /lockdown, /unlockdown,
//      /checkalt, /serverhealth, /panic
//  - Staff Help Command:
//      /securityhelp
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

const BOT_START_TIME = Date.now();

// ---------- CONFIG ----------
const GUILD_ID = "1381002127765278740";
const OWNER_ID = "1350882351743500409";

const STAFF_ROLES = [
  "1397546010317684786",
  "1381268185671667732",
  "1381268072828112896",
  "1381268070248484944"
];

// ---------- WHITELISTED ROLES (IMMUNE) ----------
const ROLE_WHITELIST = [
  "1381268070248484944",  // Group Handler
  "1395479443300159778",  // Group Oversight
  "1439267340549230765",  // Bot
  "1381394820957868095",  // Bot
  "1409181826165117003",  // Bot
  "1381268072828112896",  // Development
  "1381338812617326883"   // Bots
];

function isWhitelisted(memberOrRole) {
  if (!memberOrRole) return false;

  // Role object
  if (memberOrRole.id && memberOrRole.name && !memberOrRole.user) {
    return ROLE_WHITELIST.includes(memberOrRole.id);
  }

  // GuildMember
  if (memberOrRole.roles) {
    return memberOrRole.roles.cache.some(r => ROLE_WHITELIST.includes(r.id));
  }

  return false;
}

const LOG_CHANNEL_ID = "1439268049806168194";

// ---------- SECURITY CONFIG ----------
const SECURITY_CONFIG = {
  logChannelId: LOG_CHANNEL_ID,

  dangerousPerms: [
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageWebhooks,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.KickMembers
  ],

  raid: {
    joinWindowMs: 10_000,
    joinThreshold: 6,
    autoLock: true,
    autoUnlockMs: 5 * 60 * 1000,
    lockdownSlowmodeSeconds: 10
  },

  minAccountAgeMs: 3 * 24 * 60 * 60 * 1000, // 3 days

  maxWebhooksPerChannel: 3,
  webhookWhitelistIds: [],

  spam: { windowMs: 7_000, maxMessages: 6 },
  massMention: { maxMentions: 6 },

  trust: {
    lowTrustThreshold: -30,
    timeoutMs: 60 * 60 * 1000 // 1 hour
  }
};

// ---------- FILE HANDLING ----------
const SOFTBAN_FILE = "./softbans.json";
const HARDWARE_BAN_FILE = "./hardwarebans.json";

let softbannedUsers = new Set();
let hardwareBans = [];

if (fs.existsSync(SOFTBAN_FILE)) {
  softbannedUsers = new Set(JSON.parse(fs.readFileSync(SOFTBAN_FILE)));
} else {
  fs.writeFileSync(SOFTBAN_FILE, "[]");
}

if (fs.existsSync(HARDWARE_BAN_FILE)) {
  hardwareBans = JSON.parse(fs.readFileSync(HARDWARE_BAN_FILE));
} else {
  fs.writeFileSync(HARDWARE_BAN_FILE, "[]");
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
  if (isWhitelisted(member)) return true;
  return member.roles.cache.some(r => STAFF_ROLES.includes(r.id));
}

// ---------- SECURITY STATE ----------
const joinHistory = new Map();
const raidLockdowns = new Map();
const messageHistory = new Map();
const trustScores = new Map();
const backups = { roles: new Map(), channels: new Map() };

function getLogChannel(guild) {
  if (!guild) return null;
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

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

// ---------- BACKUPS ----------
async function backupGuildStructure(guild) {
  try {
    const rolesData = guild.roles.cache.map(r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      position: r.position,
      permissions: r.permissions.bitfield,
      mentionable: r.mentionable
    }));
    backups.roles.set(guild.id, rolesData);

    const channelsData = guild.channels.cache.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parentId: c.parentId,
      position: c.position
    }));
    backups.channels.set(guild.id, channelsData);

    console.log(`🔁 Backup updated for ${guild.name}`);
  } catch (err) {
    console.error(`Backup error for guild ${guild.id}:`, err);
  }
}

// ---------- AUTO FIX (CHANNEL) ----------
async function autoFixChannelDelete(channel) {
  const guild = channel.guild;
  const log = getLogChannel(guild);

  const snapshot = (backups.channels.get(guild.id) || [])
    .find(c => c.id === channel.id);

  if (!snapshot) return;

  try {
    const newChan = await guild.channels.create({
      name: snapshot.name,
      type: snapshot.type,
      parent: snapshot.parentId,
      position: snapshot.position
    });

    log?.send(
      `🛠️ **Channel Auto-Recreated**\n` +
      `Old: #${channel.name} (\`${channel.id}\`)\n` +
      `New: <#${newChan.id}> (\`${newChan.id}\`)`
    );
  } catch (err) {
    console.error("Auto-fix channel error:", err);
    log?.send(`❌ Failed to auto-recreate deleted channel **#${channel.name}**.`);
  }
}

// ---------- AUTO FIX (ROLE) ----------
async function autoFixRoleDelete(role) {
  if (ROLE_WHITELIST.includes(role.id)) return;

  const guild = role.guild;
  const log = getLogChannel(guild);

  const snapshot = (backups.roles.get(guild.id) || [])
    .find(r => r.id === role.id);

  if (!snapshot) return;

  try {
    const newRole = await guild.roles.create({
      name: snapshot.name,
      color: snapshot.color,
      hoist: snapshot.hoist,
      permissions: snapshot.permissions,
      mentionable: snapshot.mentionable
    });

    await newRole.setPosition(snapshot.position).catch(() => {});

    log?.send(
      `🛠️ **Role Auto-Recreated**\n` +
      `Old: ${role.name} (\`${role.id}\`)\n` +
      `New: ${newRole.name} (\`${newRole.id}\`)`
    );
  } catch (err) {
    console.error("Auto-fix role error:", err);
    log?.send(`❌ Failed to auto-recreate deleted role **${role.name}**.`);
  }
}

// ---------- RAID & ALT DETECTION ----------
async function handleJoinSecurity(member) {
  if (isWhitelisted(member)) return;

  const guild = member.guild;
  const log = getLogChannel(guild);
  const now = Date.now();

  // Alt detection
  const accountAge = now - member.user.createdTimestamp;
  if (accountAge < SECURITY_CONFIG.minAccountAgeMs) {
    const newTrust = adjustTrust(member.id, -20);
    log?.send(
      `⚠️ **Possible Alt Detected**\n` +
      `User: ${member.user.tag} (\`${member.id}\`)\n` +
      `Account age: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n` +
      `Trust score: **${newTrust}**`
    );
  } else {
    adjustTrust(member.id, 5);
  }

  // Raid detection
  let arr = joinHistory.get(guild.id) || [];
  arr.push(now);
  arr = arr.filter(t => now - t <= SECURITY_CONFIG.raid.joinWindowMs);
  joinHistory.set(guild.id, arr);

  if (
    arr.length >= SECURITY_CONFIG.raid.joinThreshold &&
    !raidLockdowns.get(guild.id)
  ) {
    raidLockdowns.set(guild.id, true);

    log?.send(
      `🚨 **RAID DETECTED**\n` +
      `Joins in last ${SECURITY_CONFIG.raid.joinWindowMs / 1000}s: **${arr.length}**\n` +
      `Lockdown enabled.`
    );

    if (SECURITY_CONFIG.raid.autoLock) {
      await enableLockdown(guild, "Automatic raid detection");
    }
  }
}

// ---------- LOCKDOWN HELPERS ----------
async function enableLockdown(guild, reason = "Manual lockdown") {
  const log = getLogChannel(guild);
  const everyone = guild.roles.everyone;

  for (const [, channel] of guild.channels.cache) {
    if (!channel.manageable || !channel.isTextBased()) continue;

    try {
      await channel.permissionOverwrites.edit(everyone, {
        SendMessages: false
      });

      ROLE_WHITELIST.forEach(id => {
        channel.permissionOverwrites.edit(id, {
          SendMessages: true
        }).catch(() => {});
      });

      if (channel.type === ChannelType.GuildText) {
        await channel.setRateLimitPerUser(
          SECURITY_CONFIG.raid.lockdownSlowmodeSeconds
        );
      }
    } catch {
      // ignore
    }
  }

  raidLockdowns.set(guild.id, true);
  log?.send(`🔒 **Lockdown Enabled**\nReason: ${reason}`);
}

async function disableLockdown(guild, reason = "Manual unlock") {
  const log = getLogChannel(guild);
  const everyone = guild.roles.everyone;

  for (const [, channel] of guild.channels.cache) {
    if (!channel.manageable || !channel.isTextBased()) continue;

    try {
      await channel.permissionOverwrites.edit(everyone, {
        SendMessages: null
      });

      if (channel.type === ChannelType.GuildText) {
        await channel.setRateLimitPerUser(0);
      }
    } catch {
      // ignore
    }
  }

  raidLockdowns.set(guild.id, false);
  log?.send(`✅ **Lockdown Disabled**\nReason: ${reason}`);
}

// ---------- MESSAGE SECURITY ----------
async function handleMessageSecurity(message) {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (isWhitelisted(message.member)) return;

  const guild = message.guild;
  const log = getLogChannel(guild);
  const now = Date.now();

  let arr = messageHistory.get(message.author.id) || [];
  arr.push(now);
  arr = arr.filter(t => now - t <= SECURITY_CONFIG.spam.windowMs);
  messageHistory.set(message.author.id, arr);

  const triggers = [];
  const content = message.content.toLowerCase();

  if (arr.length >= SECURITY_CONFIG.spam.maxMessages)
    triggers.push("Rapid messaging / spam");

  const mentionCount =
    message.mentions.users.size +
    message.mentions.roles.size +
    (message.mentions.everyone ? 1 : 0);

  if (mentionCount >= SECURITY_CONFIG.massMention.maxMentions)
    triggers.push("Mass mentions");

  const inviteRegex = /discord\.gg\/|discord\.com\/invite/i;
  if (inviteRegex.test(message.content) && !hasPermission(message.member))
    triggers.push("Untrusted invite link");

  const suspiciousPhrases = ["free nitro", "airdrop", "steamcommunity", "gift nitro"];
  if (suspiciousPhrases.some(p => content.includes(p)))
    triggers.push("Suspicious / scam phrase");

  if (triggers.length === 0) return;

  await message.delete().catch(() => {});

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

  log?.send({ embeds: [embed] });

  if (newTrust <= SECURITY_CONFIG.trust.lowTrustThreshold && message.member && message.member.moderatable) {
    try {
      await message.member.timeout(
        SECURITY_CONFIG.trust.timeoutMs,
        "Automatic security timeout (low trust)"
      );
      log?.send(
        `⏳ **User Timed Out**\n` +
        `User: ${message.author.tag} (\`${message.author.id}\`)\n` +
        `Reason: Low trust after repeated security triggers.`
      );
    } catch {
      // ignore
    }
  }
}

// ---------- ANTI-NUKE ----------
async function handleRoleUpdate(oldRole, newRole) {
  if (ROLE_WHITELIST.includes(newRole.id)) return;

  const guild = newRole.guild;
  const log = getLogChannel(guild);

  const oldDanger = SECURITY_CONFIG.dangerousPerms.some(p => oldRole.permissions.has(p));
  const newDanger = SECURITY_CONFIG.dangerousPerms.some(p => newRole.permissions.has(p));

  if (!oldDanger && newDanger) {
    try {
      await newRole.setPermissions(oldRole.permissions);
    } catch (err) {
      console.error("Failed to revert role permissions:", err);
    }

    log?.send(
      `🚫 **Permission Escalation Blocked**\n` +
      `Role: ${newRole.name} (\`${newRole.id}\`)\n` +
      `Dangerous permissions were added and automatically reverted.`
    );
  }
}

// ---------- WEBHOOK DEFENSE ----------
async function handleWebhookUpdate(channel) {
  const guild = channel.guild;
  const log = getLogChannel(guild);

  let webhooks;
  try {
    webhooks = await channel.fetchWebhooks();
  } catch {
    return;
  }

  if (!webhooks || webhooks.size === 0) return;

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
      log?.send(
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
  // Core moderation/bans
  new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Softban a user (blocked from joining).")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to softban")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unsoftban")
    .setDescription("Remove a user from the softban list.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to unsoftban")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("softbanlist")
    .setDescription("Display all softbanned users."),

  new SlashCommandBuilder()
    .setName("hardwareban")
    .setDescription("Hardware-ban a user ID.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to hardware-ban")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unhardwareban")
    .setDescription("Remove a hardware ban from a user.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to remove from hardware ban")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("hardwarebanlist")
    .setDescription("Display all hardware bans."),

  new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Lookup a Discord user by ID.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to lookup")
        .setRequired(true)
    ),

  // New security tools
  new SlashCommandBuilder()
    .setName("trustscore")
    .setDescription("View a user's security trust score.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to check trust score for")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("securitystatus")
    .setDescription("View overall security system status."),

  new SlashCommandBuilder()
    .setName("lockdown")
    .setDescription("Enable raid lockdown mode (manual)."),

  new SlashCommandBuilder()
    .setName("unlockdown")
    .setDescription("Disable raid lockdown mode (manual)."),

  new SlashCommandBuilder()
    .setName("checkalt")
    .setDescription("Check if a user looks like an alt.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to analyze")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("serverhealth")
    .setDescription("View server security health overview."),

  new SlashCommandBuilder()
    .setName("panic")
    .setDescription("Emergency: lockdown + aggressive webhook defense (5m cooldown)."),

  // Staff help menu
  new SlashCommandBuilder()
    .setName("securityhelp")
    .setDescription("Show all security bot commands and categories.")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.SECURITY_BOT_TOKEN);

// ---------- PANIC COOLDOWN ----------
const PANIC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
let lastPanicTimestamp = 0;

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

  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    await backupGuildStructure(guild);
  }
  setInterval(() => {
    const g = client.guilds.cache.get(GUILD_ID);
    if (g) backupGuildStructure(g);
  }, 10 * 60 * 1000);
});

// ---------- AUTO-KICK + RAID/ALT SECURITY ----------
client.on("guildMemberAdd", async (member) => {
  const log = member.guild.channels.cache.get(LOG_CHANNEL_ID);

  if (isWhitelisted(member)) {
    return log?.send(
      `🟢 **Whitelisted member joined:** ${member.user.tag} (\`${member.id}\`)`
    );
  }

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

  await handleJoinSecurity(member);
});

// =============== FULL COMMAND LOGGING & HANDLING ===============
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, options, guild } = interaction;
  const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);

  const args = [];
  options?._hoistedOptions?.forEach(opt => {
    args.push(`${opt.name}: ${opt.value}`);
  });

  const argString = args.length > 0 ? args.join(", ") : "No arguments";

  logChannel?.send(
    `📘 **Command Used**\n` +
    `**User:** ${member.user.tag} (\`${member.id}\`)\n` +
    `**Command:** /${commandName}\n` +
    `**Arguments:** ${argString}\n` +
    `**Timestamp:** <t:${Math.floor(Date.now() / 1000)}:F>`
  );

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
    // -------------------
    //  CORE COMMANDS
    // -------------------

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

        await interaction.reply({ embeds: [embed], ephemeral: true });

        logChannel?.send(
          `🟢 **Lookup Success**\nTarget: ${user.tag} (\`${user.id}\`)\nStaff: ${member.user.tag}`
        );
      } catch {
        await interaction.reply({
          content: "❌ Invalid user ID.",
          ephemeral: true,
        });

        logChannel?.send(
          `🔴 **Lookup Failed**\nUser ID: \`${userId}\`\nReason: Invalid ID`
        );
      }
      return;
    }

    if (commandName === "softban") {
      softbannedUsers.add(userId);
      saveSoftbans();
      await interaction.reply({ content: `🔒 Softbanned **${userId}**.`, ephemeral: true });

      logChannel?.send(
        `🟥 **Softban Added**\nUser ID: \`${userId}\`\nStaff: ${member.user.tag}`
      );
      return;
    }

    if (commandName === "unsoftban") {
      if (!softbannedUsers.has(userId)) {
        await interaction.reply({ content: "⚠️ User is not softbanned.", ephemeral: true });

        logChannel?.send(
          `🔸 **Unsoftban Failed** — Not Banned\nUser: \`${userId}\``
        );
        return;
      }

      softbannedUsers.delete(userId);
      saveSoftbans();
      await interaction.reply({ content: `🔓 Softban removed for **${userId}**.`, ephemeral: true });

      logChannel?.send(
        `🟩 **Softban Removed**\nUser: \`${userId}\`\nStaff: ${member.user.tag}`
      );
      return;
    }

    if (commandName === "softbanlist") {
      const list = [...softbannedUsers];

      await interaction.reply({
        content:
          list.length === 0
            ? "📜 No softbanned users."
            : `📜 Softbanned Users:\n${list.map(id => `• \`${id}\``).join("\n")}`,
        ephemeral: true
      });

      logChannel?.send(`📄 **Softban List Viewed** by ${member.user.tag}`);
      return;
    }

    if (commandName === "hardwareban") {
      if (hardwareBans.includes(userId)) {
        await interaction.reply({ content: "⚠️ Already hardware banned.", ephemeral: true });

        logChannel?.send(
          `🔸 **Hardware Ban Failed** — Already Banned\nUser: \`${userId}\``
        );
        return;
      }

      hardwareBans.push(userId);
      saveHardwareBans();
      await interaction.reply({ content: `🔨 Hardware banned **${userId}**.`, ephemeral: true });

      logChannel?.send(
        `🟥 **Hardware Ban Added**\nUser: \`${userId}\`\nStaff: ${member.user.tag}`
      );
      return;
    }

    if (commandName === "unhardwareban") {
      if (!hardwareBans.includes(userId)) {
        await interaction.reply({ content: "⚠️ User is not hardware banned.", ephemeral: true });

        logChannel?.send(
          `🔸 **Unhardwareban Failed** — Not Banned\nUser: \`${userId}\``
        );
        return;
      }

      hardwareBans = hardwareBans.filter(id => id !== userId);
      saveHardwareBans();

      await interaction.reply({ content: `🔓 Hardware ban removed for **${userId}**.`, ephemeral: true });

      logChannel?.send(
        `🟩 **Hardware Ban Removed**\nUser: \`${userId}\`\nStaff: ${member.user.tag}`
      );
      return;
    }

    if (commandName === "hardwarebanlist") {
      await interaction.reply({
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

    // -------------------
    //  NEW SECURITY COMMANDS
    // -------------------

    if (commandName === "trustscore") {
      const score = getTrust(userId);
      let userTag = "Unknown user";

      try {
        const u = await client.users.fetch(userId);
        userTag = u.tag;
      } catch {
        // ignore
      }

      await interaction.reply({
        content:
          `🔎 **Trust Score for \`${userTag}\` (\`${userId}\`):**\n` +
          `\`\`\`${score}\`\`\`\n` +
          `Higher = more trusted. Negative = repeatedly flagged.`,
        ephemeral: true
      });
      return;
    }

    if (commandName === "securitystatus") {
      const g = guild;
      const isLocked = raidLockdowns.get(g.id) || false;
      const joinsArray = joinHistory.get(g.id) || [];
      const recentJoins = joinsArray.filter(t => Date.now() - t <= SECURITY_CONFIG.raid.joinWindowMs).length;

      const embed = new EmbedBuilder()
        .setTitle("🛡️ Security Status")
        .setColor("#2b2d31")
        .addFields(
          { name: "Lockdown", value: isLocked ? "🔴 ACTIVE" : "🟢 Inactive", inline: true },
          { name: "Recent Joins Window", value: `${recentJoins} joins`, inline: true },
          { name: "Softbans", value: `${softbannedUsers.size}`, inline: true },
          { name: "Hardware Bans", value: `${hardwareBans.length}`, inline: true },
          { name: "Bot Uptime", value: formatDuration(Date.now() - BOT_START_TIME), inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (commandName === "lockdown") {
      await enableLockdown(guild, `Manual /lockdown by ${member.user.tag}`);
      await interaction.reply({
        content: "🔒 Lockdown enabled. Only whitelisted roles can speak.",
        ephemeral: true
      });
      return;
    }

    if (commandName === "unlockdown") {
      await disableLockdown(guild, `Manual /unlockdown by ${member.user.tag}`);
      await interaction.reply({
        content: "✅ Lockdown disabled. Chat restored.",
        ephemeral: true
      });
      return;
    }

    if (commandName === "checkalt") {
      try {
        const user = await client.users.fetch(userId);
        const now = Date.now();
        const ageMs = now - user.createdTimestamp;
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        const score = getTrust(userId);

        let risk;
        if (ageDays < 3) risk = "🔴 High (Very new account)";
        else if (ageDays < 14) risk = "🟡 Medium (New account)";
        else risk = "🟢 Low (Established account)";

        const embed = new EmbedBuilder()
          .setTitle("🧪 Alt Check")
          .setColor("#2b2d31")
          .addFields(
            { name: "User", value: `${user.tag} (\`${user.id}\`)`, inline: false },
            { name: "Account Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: true },
            { name: "Account Age (approx.)", value: `${ageDays.toFixed(1)} days`, inline: true },
            { name: "Trust Score", value: `${score}`, inline: true },
            { name: "Risk Level", value: risk, inline: false }
          )
          .setThumbnail(user.displayAvatarURL())
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch {
        await interaction.reply({
          content: "❌ Could not fetch that user ID.",
          ephemeral: true
        });
      }
      return;
    }

    if (commandName === "serverhealth") {
      const g = guild;

      const totalMembers = g.memberCount ?? "Unknown";
      let bots = 0;
      let humans = 0;

      try {
        g.members.cache.forEach(m => {
          if (m.user.bot) bots++; else humans++;
        });
      } catch {
        // ignore
      }

      const negativeTrustCount = Array.from(trustScores.values()).filter(v => v < 0).length;

      const embed = new EmbedBuilder()
        .setTitle("📊 Server Health")
        .setColor("#2b2d31")
        .addFields(
          { name: "Total Members", value: `${totalMembers}`, inline: true },
          { name: "Humans", value: `${humans}`, inline: true },
          { name: "Bots", value: `${bots}`, inline: true },
          { name: "Members Flagged (Low Trust)", value: `${negativeTrustCount}`, inline: true },
          { name: "Softbans", value: `${softbannedUsers.size}`, inline: true },
          { name: "Hardware Bans", value: `${hardwareBans.length}`, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // /panic with 5-minute cooldown (disable-webhooks style)
    if (commandName === "panic") {
      const now = Date.now();
      const elapsed = now - lastPanicTimestamp;

      if (elapsed < PANIC_COOLDOWN_MS) {
        const remaining = PANIC_COOLDOWN_MS - elapsed;
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);

        await interaction.reply({
          content:
            `❌ Panic mode is on cooldown.\n` +
            `Try again in **${minutes}m ${seconds}s**.`,
          ephemeral: true
        });

        logChannel?.send(
          `⚠️ **Panic Cooldown Prevented** — attempted by ${member.user.tag} (\`${member.id}\`).`
        );
        return;
      }

      lastPanicTimestamp = now;

      const g = guild;
      const log = getLogChannel(g);

      await enableLockdown(g, `PANIC invoked by ${member.user.tag}`);

      let totalDeleted = 0;

      for (const [, channel] of g.channels.cache) {
        if (!channel.isTextBased() || !channel.viewable) continue;

        let hooks;
        try {
          hooks = await channel.fetchWebhooks();
        } catch {
          continue;
        }

        for (const [, hook] of hooks) {
          if (!SECURITY_CONFIG.webhookWhitelistIds.includes(hook.id)) {
            try {
              await hook.delete("PANIC: disabling webhooks");
              totalDeleted++;
            } catch {
              // ignore
            }
          }
        }
      }

      log?.send(
        `🚨 **PANIC MODE ACTIVATED**\n` +
        `Invoker: ${member.user.tag} (\`${member.id}\`)\n` +
        `Webhooks removed: **${totalDeleted}**\n` +
        `Cooldown: 5 minutes`
      );

      await interaction.reply({
        content:
          "🚨 PANIC mode activated:\n" +
          "- Lockdown ON\n" +
          "- Non-whitelisted webhooks removed\n" +
          "- 5-minute global cooldown applied\n" +
          "Check #logs for more details.",
        ephemeral: true
      });
      return;
    }

    // /securityhelp
    if (commandName === "securityhelp") {
      const embed = new EmbedBuilder()
        .setTitle("🛡️ Blox & Co Security Command Menu")
        .setColor("#2b2d31")
        .setDescription(
          "All commands below are **staff-only** and protected by the security bot."
        )
        .addFields(
          {
            name: "🔧 Moderation & Ban Controls",
            value: [
              "`/softban <userid>` — Softban (auto-kick on join)",
              "`/unsoftban <userid>` — Remove softban",
              "`/softbanlist` — List softbanned IDs",
              "`/hardwareban <userid>` — Strong ban (auto-kick on join)",
              "`/unhardwareban <userid>` — Remove hardware ban",
              "`/hardwarebanlist` — List hardware bans"
            ].join("\n"),
            inline: false
          },
          {
            name: "🔎 Monitoring & Investigation",
            value: [
              "`/lookup <userid>` — Basic user info by ID",
              "`/trustscore <userid>` — View security trust score",
              "`/checkalt <userid>` — Alt/risk check",
              "`/securitystatus` — Live security system status",
              "`/serverhealth` — Server security health overview"
            ].join("\n"),
            inline: false
          },
          {
            name: "🚨 Emergency Controls",
            value: [
              "`/lockdown` — Manually enable lockdown",
              "`/unlockdown` — Manually disable lockdown",
              "`/panic` — Emergency lockdown + webhook cleanup *(5m cooldown)*"
            ].join("\n"),
            inline: false
          },
          {
            name: "ℹ Notes",
            value:
              "- Whitelisted roles are **immune** to automatic punishments.\n" +
              "- All commands are logged in the security log channel.\n" +
              "- Use `/panic` only in real emergencies."
          }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

  } catch (err) {
    console.error("❌ Command Error:", err);

    logChannel?.send(
      `🔴 **Command Error**\n` +
      `Command: /${commandName}\n` +
      `User: ${member.user.tag} (\`${member.id}\`)\n` +
      `Error: \`${err.message}\``
    );

    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ An unexpected error occurred while running that command.",
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
