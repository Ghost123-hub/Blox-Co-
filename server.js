// ==========================================
//  SECURITY BOT v3 — WITH HARDWARE BAN SYSTEM
// ==========================================

// ---------- KEEPALIVE SERVER ----------
const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("✅ Security Bot is alive."));
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Keepalive server running")
);

// ---------- DISCORD.JS ----------
const { Client, GatewayIntentBits, PermissionsBitField, SlashCommandBuilder, Routes, REST } = require("discord.js");
require("dotenv").config();
const fs = require("fs");

// ---------- CONFIG ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const OWNER_ID = "1350882351743500409";

const STAFF_ROLES = [
  "1397546010317684786",
  "1381268185671667732",
  "1381268072828112896",
  "1381268070248484944"
];

const LOG_CHANNEL_ID = "1439268049806168194";

// ---------- LOAD / SAVE HARDWARE BAN LIST ----------
const HARDWARE_BAN_FILE = "./hardwarebans.json";

let hardwareBans = [];

if (fs.existsSync(HARDWARE_BAN_FILE)) {
  hardwareBans = JSON.parse(fs.readFileSync(HARDWARE_BAN_FILE, "utf8"));
} else {
  fs.writeFileSync(HARDWARE_BAN_FILE, JSON.stringify([]));
}

function saveHardwareBans() {
  fs.writeFileSync(HARDWARE_BAN_FILE, JSON.stringify(hardwareBans, null, 4));
}

// ---------- SOFTBAN STORAGE ----------
let softbannedUsers = new Set();

// ---------- PERMISSION CHECK ----------
function hasPermission(member) {
  if (!member) return false;

  if (member.id === OWNER_ID) return true;

  return member.roles.cache.some(r => STAFF_ROLES.includes(r.id));
}

// ---------- SLASH COMMANDS ----------
const commands = [
  // SOFTBAN
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
    .setDescription("Shows all softbanned users."),

  // HARDWARE BAN
  new SlashCommandBuilder()
    .setName("hardwareban")
    .setDescription("Hardware-ban a user ID permanently.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to hardware ban")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unhardwareban")
    .setDescription("Remove a hardware ban from a user.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to un-ban")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("hardwarebanlist")
    .setDescription("Shows all hardware-banned users.")
];

const rest = new REST({ version: "10" }).setToken(process.env.SECURITY_BOT_TOKEN);

// ---------- REGISTER SLASH COMMANDS ----------
client.on("ready", async () => {
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log("✅ Slash commands registered.");
  } catch (err) {
    console.log("❌ Command registration error:", err);
  }

  console.log(`🔒 Security Bot logged in as ${client.user.tag}`);
});

// ---------- AUTO-KICK ON JOIN ----------
client.on("guildMemberAdd", async (member) => {
  // if softbanned
  if (softbannedUsers.has(member.id)) {
    await member.kick("Softbanned.");
    client.channels.cache.get(LOG_CHANNEL_ID)?.send(
      `🚫 **Softbanned user attempted to join:** ${member.user.tag} (\`${member.id}\`)`
    );
    return;
  }

  // if hardware banned
  if (hardwareBans.includes(member.id)) {
    await member.kick("Hardware banned.");
    client.channels.cache.get(LOG_CHANNEL_ID)?.send(
      `🔨 **Hardware-Banned user attempted to join:**  
       Tag: ${member.user.tag}  
       ID: \`${member.id}\``
    );
  }
});

// ---------- SLASH COMMAND HANDLER ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, options } = interaction;

  if (!hasPermission(member)) {
    return interaction.reply({
      content: "❌ You do not have permission to use this.",
      ephemeral: true
    });
  }

  const userId = options.getString("userid");

  switch (commandName) {

    // ------- SOFTBAN -------
    case "softban":
      softbannedUsers.add(userId);
      interaction.reply({ content: `🔒 Softbanned **${userId}**`, ephemeral: true });
      client.channels.cache.get(LOG_CHANNEL_ID)?.send(
        `🚫 **Softban Added**\nUser: \`${userId}\`\nStaff: ${member.user.tag}`
      );
      break;

    case "unsoftban":
      if (!softbannedUsers.has(userId))
        return interaction.reply({ content: "⚠️ User not softbanned.", ephemeral: true });

      softbannedUsers.delete(userId);
      interaction.reply({ content: `🔓 Removed softban on **${userId}**`, ephemeral: true });
      client.channels.cache.get(LOG_CHANNEL_ID)?.send(
        `🔓 **Softban Removed**\nUser: \`${userId}\`\nStaff: ${member.user.tag}`
      );
      break;

    case "softbanlist":
      interaction.reply({
        content: `📜 Softbanned Users:\n${[...softbannedUsers].join("\n") || "None"}`,
        ephemeral: true
      });
      break;

    // ------- HARDWARE BAN -------
    case "hardwareban":
      if (hardwareBans.includes(userId)) {
        return interaction.reply({ content: "⚠️ This user is already hardware banned.", ephemeral: true });
      }

      hardwareBans.push(userId);
      saveHardwareBans();

      interaction.reply({ content: `🔨 Hardware banned **${userId}**`, ephemeral: true });

      client.channels.cache.get(LOG_CHANNEL_ID)?.send(
        `🔨 **Hardware Ban Added**  
        User ID: \`${userId}\`  
        Staff: ${member.user.tag}`
      );

      break;

    case "unhardwareban":
      if (!hardwareBans.includes(userId)) {
        return interaction.reply({ content: "⚠️ User is not hardware banned.", ephemeral: true });
      }

      hardwareBans = hardwareBans.filter(id => id !== userId);
      saveHardwareBans();

      interaction.reply({ content: `🔓 Removed hardware ban for **${userId}**`, ephemeral: true });

      client.channels.cache.get(LOG_CHANNEL_ID)?.send(
        `🔓 **Hardware Ban Removed**  
        User ID: \`${userId}\`  
        Staff: ${member.user.tag}`
      );
      break;

    case "hardwarebanlist":
      interaction.reply({
        content: `📜 **Hardware Banned Users:**\n${hardwareBans.join("\n") || "None"}`,
        ephemeral: true
      });
      break;
  }
});

// ---------- LOGIN ----------
client.login(process.env.SECURITY_BOT_TOKEN);
