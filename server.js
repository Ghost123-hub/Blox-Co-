// ============================
// KEEP-ALIVE WEB SERVER (Render)
// ============================
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (_, res) => {
  res.send("✅ Blox & Co Security Bot is running.");
});

app.listen(PORT, () => {
  console.log(`🌐 Web server listening on port ${PORT}`);
});

// ============================
// DISCORD SECURITY BOT
// ============================
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  Events,
} = require("discord.js");

// ---------- CONFIG ----------
const OWNER_ID = "1350882351743500409";
const STAFF_ROLE_ID = "1381268070248484944";
const LOG_CHANNEL_ID = "1439268049806168194";
const GUILD_ID = "1381002127765278740"; // your main server

const TOKEN = process.env.SECURITY_BOT_TOKEN; // <== add this on Render

if (!TOKEN) {
  console.error("❌ SECURITY_BOT_TOKEN is missing from environment!");
  process.exit(1);
}

// ---------- CLIENT ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

// ---------- HELPER: PERMISSION CHECK ----------
function hasSecurityAccess(member) {
  if (!member) return false;
  if (member.id === OWNER_ID) return true;
  return member.roles.cache.has(STAFF_ROLE_ID);
}

// ---------- HELPER: GET LOG CHANNEL ----------
function getLogChannel() {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return null;
  return guild.channels.cache.get(LOG_CHANNEL_ID) ?? null;
}

// ---------- RAID DETECTOR ----------
const joinTimestamps = []; // store timestamps of joins (ms)
const RAID_WINDOW_MS = 60_000; // 60 seconds
const RAID_THRESHOLD = 6; // more than 6 joins in 60s => alert

function recordJoin() {
  const now = Date.now();
  joinTimestamps.push(now);
  // keep only last 60s
  while (joinTimestamps.length && now - joinTimestamps[0] > RAID_WINDOW_MS) {
    joinTimestamps.shift();
  }
  return joinTimestamps.length;
}

// ---------- ON READY ----------
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);

  // Register slash commands (global – simple & fine)
  const commands = [
    {
      name: "softban",
      description: "Soft-ban a user (ban + delete messages).",
      options: [
        {
          name: "user",
          description: "User to soft-ban",
          type: 6, // USER
          required: true,
        },
        {
          name: "reason",
          description: "Reason for the soft-ban",
          type: 3, // STRING
          required: false,
        },
      ],
    },
    {
      name: "unban",
      description: "Unban a user by ID.",
      options: [
        {
          name: "userid",
          description: "User ID to unban",
          type: 3,
          required: true,
        },
        {
          name: "reason",
          description: "Reason for unban",
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: "securityping",
      description: "Check if the security bot is online.",
    },
  ];

  try {
    await c.application.commands.set(commands);
    console.log("✅ Slash commands registered.");
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
});

// ---------- SLASH COMMAND HANDLER ----------
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // Only staff / owner allowed
  if (!hasSecurityAccess(interaction.member)) {
    await interaction.reply({
      content: "❌ You are not allowed to use security commands.",
      ephemeral: true,
    });
    return;
  }

  if (commandName === "securityping") {
    await interaction.reply({
      content: "🛡️ Blox & Co Security Bot is online and watching.",
      ephemeral: true,
    });
    return;
  }

  if (commandName === "softban") {
    const target = interaction.options.getUser("user", true);
    const reason =
      interaction.options.getString("reason") || "No reason provided";

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    // cannot softban self or bot
    if (target.id === interaction.user.id || target.id === client.user.id) {
      await interaction.reply({
        content: "❌ You cannot soft-ban that user.",
        ephemeral: true,
      });
      return;
    }

    try {
      const member = await guild.members.fetch(target.id).catch(() => null);

      // BAN with deleteMessageSeconds (7 days)
      await guild.members.ban(target.id, {
        deleteMessageSeconds: 7 * 24 * 60 * 60,
        reason: `[Softban] ${reason} | By: ${interaction.user.tag}`,
      });

      // Optional: immediately unban to make this a "classic softban"
      await guild.members.unban(target.id, "Softban (immediate unban)");

      const logChannel = getLogChannel();
      const embed = new EmbedBuilder()
        .setTitle("🛡️ Soft-ban Executed")
        .setColor(0xff0000)
        .addFields(
          { name: "Target", value: `${target.tag} (${target.id})`, inline: false },
          {
            name: "By",
            value: `${interaction.user.tag} (${interaction.user.id})`,
            inline: false,
          },
          { name: "Reason", value: reason, inline: false }
        )
        .setTimestamp();

      if (logChannel) {
        await logChannel.send({
          content: `<@&${STAFF_ROLE_ID}>`,
          embeds: [embed],
        });
      }

      await interaction.reply({
        content: `✅ Soft-banned **${target.tag}** and deleted recent messages.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error("❌ Softban error:", err);
      await interaction.reply({
        content: "❌ Failed to soft-ban that user.",
        ephemeral: true,
      });
    }
  }

  if (commandName === "unban") {
    const userId = interaction.options.getString("userid", true);
    const reason =
      interaction.options.getString("reason") || "No reason provided";

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    try {
      await guild.members.unban(userId, reason);

      const logChannel = getLogChannel();
      const embed = new EmbedBuilder()
        .setTitle("🛡️ Unban Executed")
        .setColor(0x00ff00)
        .addFields(
          { name: "User ID", value: userId, inline: false },
          {
            name: "By",
            value: `${interaction.user.tag} (${interaction.user.id})`,
            inline: false,
          },
          { name: "Reason", value: reason, inline: false }
        )
        .setTimestamp();

      if (logChannel) {
        await logChannel.send({
          content: `<@&${STAFF_ROLE_ID}>`,
          embeds: [embed],
        });
      }

      await interaction.reply({
        content: `✅ Unbanned user with ID \`${userId}\`.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error("❌ Unban error:", err);
      await interaction.reply({
        content:
          "❌ Failed to unban. Double-check the ID and that the user is banned.",
        ephemeral: true,
      });
    }
  }
});

// ---------- MESSAGE PROTECTION (LINK FILTER) ----------
const LINK_REGEX = /(https?:\/\/|discord\.gg)/i;

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  // Ignore messages outside your main guild
  if (message.guild.id !== GUILD_ID) return;

  // Delete-only link protection
  if (LINK_REGEX.test(message.content)) {
    try {
      await message.delete().catch(() => {});
    } catch {}

    const logChannel = getLogChannel();
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setTitle("🔗 Link Deleted")
        .setColor(0xffa500)
        .addFields(
          {
            name: "User",
            value: `${message.author.tag} (${message.author.id})`,
          },
          {
            name: "Channel",
            value: `${message.channel} (${message.channel.id})`,
          },
          {
            name: "Content",
            value: message.content.slice(0, 1024) || "(empty)",
          }
        )
        .setTimestamp();

      await logChannel.send({
        content: `<@&${STAFF_ROLE_ID}>`,
        embeds: [embed],
      });
    }
  }
});

// ---------- RAID DETECTION ----------
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  const count = recordJoin();
  if (count >= RAID_THRESHOLD) {
    const logChannel = getLogChannel();
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setTitle("🚨 Possible Raid Detected")
        .setColor(0xff0000)
        .setDescription(
          `Detected **${count}** joins in the last **60 seconds**.\n` +
            `Latest join: ${member.user.tag} (${member.user.id})`
        )
        .setTimestamp();

      await logChannel.send({
        content: `<@&${STAFF_ROLE_ID}>`,
        embeds: [embed],
      });
    }
  }
});

// ---------- ROLE & CHANNEL PROTECTION ----------
async function logAuditEvent(eventTitle, color, guild, type, targetName) {
  try {
    const logs = await guild.fetchAuditLogs({ limit: 1, type });
    const entry = logs.entries.first();
    if (!entry) return;

    const executor = entry.executor;
    const logChannel = getLogChannel();
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle(eventTitle)
      .setColor(color)
      .addFields(
        { name: "Target", value: targetName, inline: false },
        {
          name: "By",
          value: executor
            ? `${executor.tag} (${executor.id})`
            : "Unknown executor",
          inline: false,
        }
      )
      .setTimestamp();

    await logChannel.send({
      content: `<@&${STAFF_ROLE_ID}>`,
      embeds: [embed],
    });
  } catch (err) {
    console.error("❌ Audit log error:", err);
  }
}

client.on(Events.ChannelDelete, async (channel) => {
  if (channel.guild?.id !== GUILD_ID) return;
  await logAuditEvent(
    "⚠️ Channel Deleted",
    0xff0000,
    channel.guild,
    "CHANNEL_DELETE",
    `${channel.name} (${channel.id})`
  );
});

client.on(Events.RoleDelete, async (role) => {
  if (role.guild?.id !== GUILD_ID) return;
  await logAuditEvent(
    "⚠️ Role Deleted",
    0xff0000,
    role.guild,
    "ROLE_DELETE",
    `${role.name} (${role.id})`
  );
});

client.on(Events.RoleUpdate, async (oldRole, newRole) => {
  if (newRole.guild?.id !== GUILD_ID) return;
  if (oldRole.permissions.bitfield === newRole.permissions.bitfield) return;
  await logAuditEvent(
    "⚠️ Role Permissions Changed",
    0xffa500,
    newRole.guild,
    "ROLE_UPDATE",
    `${newRole.name} (${newRole.id})`
  );
});

// ---------- LOGIN ----------
client.login(TOKEN).catch((err) => {
  console.error("❌ Failed to login:", err);
  process.exit(1);
});
