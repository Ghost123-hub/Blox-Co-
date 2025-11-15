// ============================
// Blox & Co Security Bot – Full Moderation Suite
// ============================

// ---- Load env vars ----
require("dotenv").config();

// ============================
// Simple Express server (for Render/Uptime checks)
// ============================
const express = require("express");
const app = express();
const HTTP_PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🛡️ Blox & Co Security Bot is running!");
});

app.listen(HTTP_PORT, () => {
  console.log(`🌐 Web server listening on port ${HTTP_PORT}`);
});

// ============================
// DISCORD.JS SECURITY BOT
// ============================
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.User, Partials.GuildMember],
});

// ============================
// CONFIG
// ============================
const OWNER_ID = "1350882351743500409";
const STAFF_ROLE = "1381268070248484944";
const LOG_CHANNEL = "1439268049806168194";

// ============================
// PERMISSION CHECK
// ============================
function canUse(interaction) {
  if (!interaction || !interaction.member) return false;
  if (interaction.user.id === OWNER_ID) return true;
  if (interaction.member.roles.cache.has(STAFF_ROLE)) return true;
  return false;
}

// ============================
// COMMAND DEFINITIONS
// ============================
const commands = [
  {
    name: "softban",
    description: "Softban a user by ID (works offline)",
    options: [
      {
        name: "userid",
        description: "User ID to softban",
        type: 3,
        required: true,
      },
      {
        name: "reason",
        description: "Reason for softban",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "hardban",
    description: "Permanently ban a user by ID",
    options: [
      {
        name: "userid",
        description: "User ID to ban",
        type: 3,
        required: true,
      },
      {
        name: "reason",
        description: "Reason for ban",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "unban",
    description: "Unban a user by ID",
    options: [
      {
        name: "userid",
        description: "User ID to unban",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "kick",
    description: "Kick a user (must be in server)",
    options: [
      {
        name: "user",
        description: "User to kick",
        type: 6,
        required: true,
      },
      {
        name: "reason",
        description: "Reason for kick",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "warn",
    description: "Warn a user (offline supported)",
    options: [
      {
        name: "userid",
        description: "User ID to warn",
        type: 3,
        required: true,
      },
      {
        name: "reason",
        description: "Reason for warning",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "lookup",
    description: "Lookup a user's info by ID",
    options: [
      {
        name: "userid",
        description: "The user ID to look up",
        type: 3,
        required: true,
      },
    ],
  },
];

// ============================
// REGISTER SLASH COMMANDS (GLOBAL)
// ============================
const rest = new REST({ version: "10" }).setToken(process.env.SECURITY_BOT_TOKEN);

client.once("ready", async () => {
  console.log(`🔒 Security Bot Logged in as ${client.user.tag}`);

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log("✅ Slash commands registered");
  } catch (err) {
    console.error("❌ Error registering slash commands:", err);
  }
});

// ============================
// COMMAND LOGIC
// ============================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Permission check
  if (!canUse(interaction)) {
    return interaction.reply({
      content: "❌ You are not allowed to use this command.",
      ephemeral: true,
    });
  }

  const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL);

  // ============================
  // SOFTBAN
  // ============================
  if (interaction.commandName === "softban") {
    const id = interaction.options.getString("userid");
    const reason = interaction.options.getString("reason") || "No reason";

    try {
      const user = await client.users.fetch(id);

      await interaction.guild.members.ban(id, {
        deleteMessageSeconds: 7 * 24 * 3600,
        reason: reason,
      });

      await interaction.guild.members.unban(id, "Softban cleanup");

      await interaction.reply(`🔨 Softbanned **${user.tag}**`);

      logChannel?.send(
        `🛡️ **Softban**\n👤 User: ${user.tag}\n📄 Reason: ${reason}\n👮 By: ${interaction.user.tag}`
      );
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: "❌ Invalid ID or missing permissions.",
        ephemeral: true,
      });
    }
  }

  // ============================
  // HARDBAN
  // ============================
  if (interaction.commandName === "hardban") {
    const id = interaction.options.getString("userid");
    const reason = interaction.options.getString("reason") || "No reason";

    try {
      const user = await client.users.fetch(id);

      await interaction.guild.members.ban(id, { reason });

      await interaction.reply(`⛔ Hardbanned **${user.tag}**`);

      logChannel?.send(
        `🚨 **Hardban**\n👤 User: ${user.tag}\n📄 Reason: ${reason}\n👮 By: ${interaction.user.tag}`
      );
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: "❌ Failed to ban user.",
        ephemeral: true,
      });
    }
  }

  // ============================
  // UNBAN
  // ============================
  if (interaction.commandName === "unban") {
    const id = interaction.options.getString("userid");

    try {
      const user = await client.users.fetch(id);

      await interaction.guild.members.unban(id);

      await interaction.reply(`🔓 Unbanned **${user.tag}**`);

      logChannel?.send(
        `🔓 **Unban**\n👤 User: ${user.tag}\n👮 By: ${interaction.user.tag}`
      );
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: "❌ Failed to unban.",
        ephemeral: true,
      });
    }
  }

  // ============================
  // KICK
  // ============================
  if (interaction.commandName === "kick") {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason";

    try {
      const member = await interaction.guild.members.fetch(user.id);
      await member.kick(reason);

      await interaction.reply(`👢 Kicked **${user.tag}**`);

      logChannel?.send(
        `👢 **Kick**\n👤 User: ${user.tag}\n📄 Reason: ${reason}\n👮 By: ${interaction.user.tag}`
      );
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: "❌ Failed to kick user.",
        ephemeral: true,
      });
    }
  }

  // ============================
  // WARN
  // ============================
  if (interaction.commandName === "warn") {
    const id = interaction.options.getString("userid");
    const reason = interaction.options.getString("reason") || "No reason";

    try {
      const user = await client.users.fetch(id);

      await interaction.reply(`⚠️ Warned **${user.tag}**`);

      logChannel?.send(
        `⚠️ **Warning**\n👤 User: ${user.tag}\n📄 Reason: ${reason}\n👮 By: ${interaction.user.tag}`
      );
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: "❌ Failed to warn user.",
        ephemeral: true,
      });
    }
  }

  // ============================
  // LOOKUP
  // ============================
  if (interaction.commandName === "lookup") {
    const id = interaction.options.getString("userid");

    try {
      const user = await client.users.fetch(id);

      const created = `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`;

      await interaction.reply(
        `🕵️ **User Lookup**\n\n` +
        `👤 Username: **${user.tag}**\n` +
        `🆔 ID: ${user.id}\n` +
        `📅 Created: ${created}`
      );
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: "❌ Invalid ID.",
        ephemeral: true,
      });
    }
  }
});

// ============================
// LOGIN
// ============================
const token = process.env.SECURITY_BOT_TOKEN;
if (!token) {
  console.error("❌ SECURITY_BOT_TOKEN is missing from environment variables!");
} else {
  client.login(token);
}
