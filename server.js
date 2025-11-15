// ================================
// SECURITY BOT - UPDATED VERSION
// ================================

// ----------------------
// KEEP-ALIVE EXPRESS APP
// ----------------------
const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("✅ Security Bot Running"));
app.listen(process.env.PORT || 3000);

// ----------------------
// DISCORD BOT SETUP
// ----------------------
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  SlashCommandBuilder,
  Routes,
  REST 
} = require("discord.js");

require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ----------------------
// CONFIG
// ----------------------
const OWNER_ID = "1350882351743500409";

const STAFF_ROLES = [
  "1381268070248484944",
  "1381268072828112896"
];

const LOG_CHANNEL = "1439268049806168194";

// Softbanned users stored in memory
let bannedUsers = [];

// ----------------------
// PERMISSION CHECK
// ----------------------
function hasPermission(member) {
  if (!member) return false;

  // owner always allowed
  if (member.id === OWNER_ID) return true;

  // check if user has any allowed roles
  return member.roles.cache.some(role => STAFF_ROLES.includes(role.id));
}

// ----------------------
// DEFINE SLASH COMMANDS
// ----------------------
const commands = [
  new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Softban a user (removes them on rejoin).")
    .addStringOption(opt => 
      opt.setName("user_id")
        .setDescription("The user ID to softban")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unsoftban")
    .setDescription("Remove a user from the softban list.")
    .addStringOption(opt =>
      opt.setName("user_id")
        .setDescription("The user ID to unban")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("softbanlist")
    .setDescription("Show all softbanned users.")
].map(cmd => cmd.toJSON());

// ----------------------
// REGISTER SLASH COMMANDS
// ----------------------
const rest = new REST({ version: "10" }).setToken(process.env.SECURITY_BOT_TOKEN);

(async () => {
  try {
    console.log("⏳ Registering slash commands...");
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("✅ Slash commands registered!");
  } catch (err) {
    console.error("❌ Error registering slash commands:", err);
  }
})();

// ----------------------
// EVENT: BOT READY
// ----------------------
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ----------------------
// EVENT: MEMBER JOINS
// AUTO-KICK IF SOFTBANNED
// ----------------------
client.on("guildMemberAdd", member => {
  if (bannedUsers.includes(member.id)) {
    member.kick("Softbanned user rejoined.");

    const log = member.guild.channels.cache.get(LOG_CHANNEL);
    if (log) {
      log.send(
        `🚨 **Auto-Kicked Softbanned User**\nUser: <@${member.id}> (${member.id})`
      );
    }
  }
});

// ----------------------
// SLASH COMMAND HANDLER
// ----------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (!hasPermission(interaction.member)) {
    return interaction.reply({
      content: "❌ You do not have permission to use this command.",
      ephemeral: true
    });
  }

  // --------------- SOFTBAN ----------------
  if (commandName === "softban") {
    const userId = interaction.options.getString("user_id");

    if (!bannedUsers.includes(userId)) {
      bannedUsers.push(userId);
    }

    const log = interaction.guild.channels.cache.get(LOG_CHANNEL);
    if (log) {
      log.send(`🔨 **Softban Added**\nUser ID: ${userId}\nExecutor: <@${interaction.user.id}>`);
    }

    return interaction.reply(`✅ User ID **${userId}** has been softbanned.`);
  }

  // ---------------- UNSOFTBAN -----------------
  if (commandName === "unsoftban") {
    const userId = interaction.options.getString("user_id");

    bannedUsers = bannedUsers.filter(id => id !== userId);

    const log = interaction.guild.channels.cache.get(LOG_CHANNEL);
    if (log) {
      log.send(`🔓 **Softban Removed**\nUser ID: ${userId}\nExecutor: <@${interaction.user.id}>`);
    }

    return interaction.reply(`✅ User ID **${userId}** has been unsoftbanned.`);
  }

  // ---------------- BAN LIST -----------------
  if (commandName === "softbanlist") {
    if (bannedUsers.length === 0)
      return interaction.reply("📭 No softbanned users.");

    return interaction.reply(
      "**📌 Softbanned Users:**\n" +
      bannedUsers.map(id => `• ${id}`).join("\n")
    );
  }
});

// ----------------------
// LOGIN BOT
// ----------------------
client.login(process.env.SECURITY_BOT_TOKEN);
