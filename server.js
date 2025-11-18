// ==========================================
//  BLOX & CO SECURITY BOT v5
//  - Softban + Hardware Ban
//  - Lookup Command
//  - Staff Role-Gated Slash Commands
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
  EmbedBuilder
} = require("discord.js");
require("dotenv").config();
const fs = require("fs");

// ---------- CLIENT ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
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

// ---------- FILES ----------
const SOFTBAN_FILE = "./softbans.json";
const HARDWARE_BAN_FILE = "./hardwarebans.json";

let softbannedUsers = new Set();
let hardwareBans = [];

// Load stored data
if (fs.existsSync(SOFTBAN_FILE)) {
  softbannedUsers = new Set(JSON.parse(fs.readFileSync(SOFTBAN_FILE)));
} else {
  fs.writeFileSync(SOFTBAN_FILE, JSON.stringify([]));
}

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

// ---------- SLASH COMMAND DEFINITIONS ----------
const commands = [

  // SOFTBAN
  new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Softban a user (blocked from joining).")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unsoftban")
    .setDescription("Remove a user from the softban list.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("softbanlist")
    .setDescription("Display all softbanned users."),

  // HARDWARE BAN
  new SlashCommandBuilder()
    .setName("hardwareban")
    .setDescription("Hardware-ban a user ID.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unhardwareban")
    .setDescription("Remove a hardware ban from a user.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("hardwarebanlist")
    .setDescription("Display all hardware bans."),

  // LOOKUP
  new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Lookup a Discord user by ID.")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID to lookup")
        .setRequired(true)
    )

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
});

// ---------- AUTO-KICK ----------
client.on("guildMemberAdd", async (member) => {
  const log = member.guild.channels.cache.get(LOG_CHANNEL_ID);

  if (softbannedUsers.has(member.id)) {
    await member.kick("Softbanned.");
    return log?.send(`🚫 **Softbanned user attempted to join:** ${member.user.tag} (\`${member.id}\`)`);
  }

  if (hardwareBans.includes(member.id)) {
    await member.kick("Hardware banned.");
    return log?.send(`🔨 **Hardware-Banned user attempted to join:** ${member.user.tag} (\`${member.id}\`)`);
  }
});

// ---------- COMMAND HANDLER ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, options } = interaction;

  if (!hasPermission(member)) {
    return interaction.reply({ content: "❌ You do not have permission.", ephemeral: true });
  }

  const userId = options.getString("userid");

  try {

    // --- /lookup ---
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

        return interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (err) {
        return interaction.reply({
          content: "❌ Invalid user ID or user not found.",
          ephemeral: true
        });
      }
    }

    // --- SOFTBAN ---
    if (commandName === "softban") {
      softbannedUsers.add(userId);
      saveSoftbans();
      interaction.reply({ content: `🔒 Softbanned **${userId}**.`, ephemeral: true });
      client.channels.cache.get(LOG_CHANNEL_ID)?.send(`🚫 Softban Added\nID: \`${userId}\`\nStaff: ${member.user.tag}`);
    }

    if (commandName === "unsoftban") {
      if (!softbannedUsers.has(userId))
        return interaction.reply({ content: "⚠️ User is not softbanned.", ephemeral: true });

      softbannedUsers.delete(userId);
      saveSoftbans();
      interaction.reply({ content: `🔓 Removed softban for **${userId}**.`, ephemeral: true });
    }

    if (commandName === "softbanlist") {
      const list = [...softbannedUsers];
      interaction.reply({
        content: list.length === 0 ?
          "📜 No users softbanned." :
          `📜 Softbanned Users:\n${list.map(id => `• \`${id}\``).join("\n")}`,
        ephemeral: true
      });
    }

    // --- HARDWARE ---
    if (commandName === "hardwareban") {
      if (hardwareBans.includes(userId))
        return interaction.reply({ content: "⚠️ Already hardware banned.", ephemeral: true });

      hardwareBans.push(userId);
      saveHardwareBans();
      interaction.reply({ content: `🔨 Hardware banned **${userId}**.`, ephemeral: true });
    }

    if (commandName === "unhardwareban") {
      if (!hardwareBans.includes(userId))
        return interaction.reply({ content: "⚠️ User is not hardware banned.", ephemeral: true });

      hardwareBans = hardwareBans.filter((id) => id !== userId);
      saveHardwareBans();
      interaction.reply({ content: `🔓 Removed hardware ban for **${userId}**.`, ephemeral: true });
    }

    if (commandName === "hardwarebanlist") {
      interaction.reply({
        content:
          hardwareBans.length === 0 ?
            "📜 No hardware bans." :
            `📜 Hardware Bans:\n${hardwareBans.map(id => `• \`${id}\``).join("\n")}`,
        ephemeral: true
      });
    }

  } catch (err) {
    console.error("❌ Command error:", err);
    interaction.reply({ content: "❌ An error occurred.", ephemeral: true });
  }
});

// ---------- LOGIN ----------
client.login(process.env.SECURITY_BOT_TOKEN);
