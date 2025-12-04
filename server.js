// ==========================================
//  BLOX & CO SECURITY BOT v7 (Whitelist Edition + Command Fix Patch)
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

// ---------- WHITELISTED ROLES (IMMUNE TO ALL SECURITY SYSTEMS) ----------
const ROLE_WHITELIST = [
  "1381268070248484944",  // Group Handler
  "1395479443300159778",  // Group Oversight
  "1439267340549230765",  // Bot
  "1381394820957868095",  // Bot
  "1409181826165117003",  // Bot
  "1381268072828112896",  // Development
  "1381338812617326883"   // Bots
];

function isWhitelisted(member) {
  if (!member || !member.roles) return false;
  return member.roles.cache.some(r => ROLE_WHITELIST.includes(r.id));
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
    joinWindowMs: 10000,
    joinThreshold: 6,
    autoLock: true,
    autoUnlockMs: 5 * 60 * 1000,
    lockdownSlowmodeSeconds: 10
  },

  minAccountAgeMs: 3 * 24 * 60 * 60 * 1000,

  maxWebhooksPerChannel: 3,
  webhookWhitelistIds: [],

  spam: { windowMs: 7000, maxMessages: 6 },
  massMention: { maxMentions: 6 },

  trust: {
    lowTrustThreshold: -30,
    timeoutMs: 60 * 60 * 1000
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
  return guild.channels.cache.get(LOG_CHANNEL_ID) || null;
}

function adjustTrust(userId, delta) {
  const old = trustScores.get(userId) || 0;
  const next = old + delta;
  trustScores.set(userId, next);
  return next;
}

// ---------- BACKUPS ----------
async function backupGuildStructure(guild) {
  const rolesData = guild.roles.cache.map(r => ({
    id: r.id, name: r.name, color: r.color, hoist: r.hoist,
    position: r.position, permissions: r.permissions.bitfield,
    mentionable: r.mentionable
  }));
  backups.roles.set(guild.id, rolesData);

  const channelsData = guild.channels.cache.map(c => ({
    id: c.id, name: c.name, type: c.type,
    parentId: c.parentId, position: c.position
  }));
  backups.channels.set(guild.id, channelsData);

  console.log(`🔁 Backup updated for ${guild.name}`);
}

// ---------- AUTO FIX (Channel) ----------
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

    log?.send(`🛠️ Auto-Fixed Deleted Channel → <#${newChan.id}>`);
  } catch {
    log?.send(`❌ Failed to auto-fix deleted channel.`);
  }
}

// ---------- AUTO FIX (Role) ----------
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

    log?.send(`🛠️ Auto-Recreated Role: **${snapshot.name}**`);
  } catch {
    log?.send(`❌ Failed to auto-recreate deleted role.`);
  }
}

// ---------- RAID & ALT DETECTION ----------
async function handleJoinSecurity(member) {
  if (isWhitelisted(member)) return;

  const guild = member.guild;
  const log = getLogChannel(guild);
  const now = Date.now();

  const accountAge = now - member.user.createdTimestamp;
  if (accountAge < SECURITY_CONFIG.minAccountAgeMs) {
    adjustTrust(member.id, -20);
    log?.send(`⚠️ Possible Alt: ${member.user.tag}`);
  }

  let arr = joinHistory.get(guild.id) || [];
  arr.push(now);
  arr = arr.filter(t => now - t <= SECURITY_CONFIG.raid.joinWindowMs);
  joinHistory.set(guild.id, arr);

  if (arr.length >= SECURITY_CONFIG.raid.joinThreshold) {
    log?.send(`🚨 RAID DETECTED!`);
    raidLockdowns.set(guild.id, true);

    for (const [, channel] of guild.channels.cache) {
      if (!channel.manageable || !channel.isTextBased()) continue;

      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: false
      }).catch(() => {});

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
    }
  }
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
    triggers.push("Spam detected");

  const mentionCount =
    message.mentions.users.size +
    message.mentions.roles.size +
    (message.mentions.everyone ? 1 : 0);

  if (mentionCount >= SECURITY_CONFIG.massMention.maxMentions)
    triggers.push("Mass mention");

  const invites = /discord\.gg|discord\.com\/invite/i;
  if (invites.test(message.content) && !hasPermission(message.member))
    triggers.push("Unauthorized invite link");

  const scams = ["free nitro", "airdrop", "steamcommunity", "gift nitro"];
  if (scams.some(k => content.includes(k)))
    triggers.push("Scam link");

  if (triggers.length === 0) return;

  await message.delete().catch(() => {});
  adjustTrust(message.author.id, -10);

  log?.send(`🛡️ Message Blocked from ${message.author.tag}\nReason: ${triggers.join(", ")}`);
}

// ---------- ANTI-NUKE ----------
async function handleRoleUpdate(oldRole, newRole) {
  if (ROLE_WHITELIST.includes(newRole.id)) return;

  const guild = newRole.guild;
  const log = getLogChannel(guild);

  const oldDanger = SECURITY_CONFIG.dangerousPerms.some(p => oldRole.permissions.has(p));
  const newDanger = SECURITY_CONFIG.dangerousPerms.some(p => newRole.permissions.has(p));

  if (!oldDanger && newDanger) {
    await newRole.setPermissions(oldRole.permissions).catch(() => {});
    log?.send(`🚫 Blocked Permission Escalation for role **${newRole.name}**`);
  }
}

// ---------- WEBHOOK DEFENSE ----------
async function handleWebhookUpdate(channel) {
  const guild = channel.guild;
  const log = getLogChannel(guild);

  const hooks = await channel.fetchWebhooks().catch(() => null);
  if (!hooks || hooks.size === 0) return;

  if (hooks.size > SECURITY_CONFIG.maxWebhooksPerChannel) {
    let removed = 0;
    for (const [, hook] of hooks) {
      if (!SECURITY_CONFIG.webhookWhitelistIds.includes(hook.id)) {
        await hook.delete("Excess webhook cleanup").catch(() => {});
        removed++;
      }
    }
    if (removed > 0) log?.send(`🧹 Removed ${removed} webhooks from ${channel.name}`);
  }
}

// ---------- BAN LOGS ----------
async function getAuditExecutor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 1 });
    const entry = logs.entries.first();
    if (!entry) return null;
    if (targetId && entry.target?.id !== targetId) return null;
    return entry.executor;
  } catch {
    return null;
  }
}

// ---------- COMMAND DEFINITIONS (PATCHED & FIXED) ----------
const commands = [
  new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Softban a user.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to softban")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unsoftban")
    .setDescription("Remove a softban from a user.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to unsoftban")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("softbanlist")
    .setDescription("View all softbanned users."),

  new SlashCommandBuilder()
    .setName("hardwareban")
    .setDescription("Hardware-ban a user.")
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
        .setDescription("User ID to remove")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("hardwarebanlist")
    .setDescription("View all hardware-banned users."),

  new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Lookup a user by Discord ID.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to lookup")
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

// ---------- READY ----------
client.on("ready", async () => {
  console.log(`🔒 Logged in as ${client.user.tag}`);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });

  client.user.setPresence({ activities: [{ name: "Blox & Co Security" }], status: "online" });

  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) backupGuildStructure(guild);

  setInterval(() => {
    const g = client.guilds.cache.get(GUILD_ID);
    if (g) backupGuildStructure(g);
  }, 10 * 60 * 1000);
});

// ---------- MEMBER JOIN ----------
client.on("guildMemberAdd", async (member) => {
  const log = getLogChannel(member.guild);

  if (isWhitelisted(member)) {
    return log?.send(`🟢 Whitelisted member joined: ${member.user.tag}`);
  }

  if (softbannedUsers.has(member.id)) {
    await member.kick("Softbanned.");
    return log?.send(`🚫 Softbanned user tried to join: ${member.user.tag}`);
  }

  if (hardwareBans.includes(member.id)) {
    await member.kick("Hardware banned.");
    return log?.send(`🔨 Hardware-banned user tried to join: ${member.user.tag}`);
  }

  await handleJoinSecurity(member);
});

// ---------- MESSAGE SECURITY ----------
client.on("messageCreate", async (message) => {
  await handleMessageSecurity(message);
});

// ---------- SECURITY LOGGING ----------
client.on("roleUpdate", handleRoleUpdate);

client.on("roleDelete", async (role) => {
  if (ROLE_WHITELIST.includes(role.id)) return;
  await autoFixRoleDelete(role);
});

client.on("channelDelete", async (channel) => {
  await autoFixChannelDelete(channel);
});

client.on("webhooksUpdate", handleWebhookUpdate);

client.on("guildBanAdd", async (ban) => {
  const log = getLogChannel(ban.guild);
  const executor = await getAuditExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
  log?.send(`🔨 ${ban.user.tag} banned by ${executor?.tag ?? "Unknown"}`);
});

client.on("guildBanRemove", async (ban) => {
  const log = getLogChannel(ban.guild);
  const executor = await getAuditExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
  log?.send(`♻️ ${ban.user.tag} unbanned by ${executor?.tag ?? "Unknown"}`);
});

// ---------- LOGIN ----------
client.login(process.env.SECURITY_BOT_TOKEN);
