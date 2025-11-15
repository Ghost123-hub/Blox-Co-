// ==========================================
//  BLOX & CO SECURITY BOT v4
//  - Softban + Hardware Ban
//  - Guild Slash Commands
//  - Role-gated usage, visible to staff
// ==========================================

// ---------- KEEPALIVE SERVER ----------
const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("✅ Security Bot is alive."));
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Keepalive server running")
);

// ---------- IMPORTS ----------
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  REST,
} = require("discord.js");
require("dotenv").config();
const fs = require("fs");

// ---------- CONFIG ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// Your main guild (server) ID
const GUILD_ID = "1381002127765278740";

// You (owner)
const OWNER_ID = "1350882351743500409";

// Staff roles that can USE commands
const STAFF_ROLES = [
  "1397546010317684786", // Group Handler
  "1381268185671667732", // Group Developers
  "1381268072828112896", // Board of Directors
  "1381268070248484944", // Group Moderators
];

const LOG_CHANNEL_ID = "1439268049806168194";

// ---------- FILES FOR STORAGE ----------
const SOFTBAN_FILE = "./softbans.json";
const HARDWARE_BAN_FILE = "./hardwarebans.json";

// Load softbans
let softbannedUsers = new Set();
if (fs.existsSync(SOFTBAN_FILE)) {
  try {
    const arr = JSON.parse(fs.readFileSync(SOFTBAN_FILE, "utf8"));
    if (Array.isArray(arr)) softbannedUsers = new Set(arr);
  } catch (e) {
    console.error("❌ Failed to read softbans.json, starting empty:", e);
  }
} else {
  fs.writeFileSync(SOFTBAN_FILE, JSON.stringify([]));
}

// Load hardware bans
let hardwareBans = [];
if (fs.existsSync(HARDWARE_BAN_FILE)) {
  try {
    const arr = JSON.parse(fs.readFileSync(HARDWARE_BAN_FILE, "utf8"));
    if (Array.isArray(arr)) hardwareBans = arr;
  } catch (e) {
    console.error("❌ Failed to read hardwarebans.json, starting empty:", e);
  }
} else {
  fs.writeFileSync(HARDWARE_BAN_FILE, JSON.stringify([]));
}

// Save helpers
function saveSoftbans() {
  try {
    fs.writeFileSync(SOFTBAN_FILE, JSON.stringify([...softbannedUsers], null, 2));
  } catch (e) {
    console.error("❌ Failed to save softbans.json:", e);
  }
}

function saveHardwareBans() {
  try {
    fs.writeFileSync(HARDWARE_BAN_FILE, JSON.stringify(hardwareBans, null, 2));
  } catch (e) {
    console.error("❌ Failed to save hardwarebans.json:", e);
  }
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
    .addStringOption((o) =>
      o.setName("userid").setDescription("User ID to softban").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unsoftban")
    .setDescription("Remove a user from the softban list.")
    .addStringOption((o) =>
      o.setName("userid").setDescription("User ID to unsoftban").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("softbanlist")
    .setDescription("Shows all softbanned users."),

  // HARDWARE BAN
  new SlashCommandBuilder()
    .setName("hardwareban")
    .setDescription("Hardware-ban a user ID permanently.")
    .addStringOption((o) =>
      o.setName("userid").setDescription("User ID to hardware ban").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unhardwareban")
    .setDescription("Remove a hardware ban from a user.")
    .addStringOption((o) =>
      o.setName("userid").setDescription("User ID to un-ban").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("hardwarebanlist")
    .setDescription("Shows all hardware-banned users."),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.SECURITY_BOT_TOKEN);

// ---------- READY EVENT ----------
client.on("ready", async () => {
  console.log(`🔒 Security Bot logged in as ${client.user.tag}`);

  try {
    // Register commands ONLY for your guild (fast updates)
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands }
    );
    console.log("✅ Guild slash commands registered.");
  } catch (err) {
    console.error("❌ Command registration error:", err);
  }

  // Optional status
  client.user.setPresence({
    activities: [{ name: "Blox & Co Security", type: 0 }],
    status: "online",
  });
});

// ---------- AUTO-KICK ON JOIN ----------
client.on("guildMemberAdd", async (member) => {
  const logChannel = member.guild.channels.cache.get(LOG_CHANNEL_ID);

  // Softban check
  if (softbannedUsers.has(member.id)) {
    await member.kick("Softbanned.");
    logChannel?.send(
      `🚫 **Softbanned user attempted to join:** ${member.user.tag} (\`${member.id}\`)`
    );
    return;
  }

  // Hardware ban check
  if (hardwareBans.includes(member.id)) {
    await member.kick("Hardware banned.");
    logChannel?.send(
      `🔨 **Hardware-Banned user attempted to join:**\nTag: ${member.user.tag}\nID: \`${member.id}\``
    );
  }
});

// ---------- SLASH COMMAND HANDLER ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, options } = interaction;

  if (!hasPermission(member)) {
    return interaction.reply({
      content: "❌ You do not have permission to use this command.",
      ephemeral: true,
    });
  }

  const userId = options.getString("userid");

  try {
    switch (commandName) {
      // ------- SOFTBAN -------
      case "softban": {
        softbannedUsers.add(userId);
        saveSoftbans();

        interaction.reply({
          content: `🔒 Softbanned **${userId}**.`,
          ephemeral: true,
        });

        client.channels.cache.get(LOG_CHANNEL_ID)?.send(
          `🚫 **Softban Added**\nUser ID: \`${userId}\`\nStaff: ${member.user.tag} (\`${member.id}\`)`
        );
        break;
      }

      case "unsoftban": {
        if (!softbannedUsers.has(userId)) {
          return interaction.reply({
            content: "⚠️ That user is not softbanned.",
            ephemeral: true,
          });
        }

        softbannedUsers.delete(userId);
        saveSoftbans();

        interaction.reply({
          content: `🔓 Removed softban on **${userId}**.`,
          ephemeral: true,
        });

        client.channels.cache.get(LOG_CHANNEL_ID)?.send(
          `🔓 **Softban Removed**\nUser ID: \`${userId}\`\nStaff: ${member.user.tag} (\`${member.id}\`)`
        );
        break;
      }

      case "softbanlist": {
        const list = [...softbannedUsers];
        return interaction.reply({
          content:
            list.length === 0
              ? "📜 No users are currently softbanned."
              : `📜 **Softbanned Users:**\n${list.map((id) => `• \`${id}\``).join("\n")}`,
          ephemeral: true,
        });
      }

      // ------- HARDWARE BAN -------
      case "hardwareban": {
        if (hardwareBans.includes(userId)) {
          return interaction.reply({
            content: "⚠️ This user is already hardware banned.",
            ephemeral: true,
          });
        }

        hardwareBans.push(userId);
        saveHardwareBans();

        interaction.reply({
          content: `🔨 Hardware banned **${userId}**.`,
          ephemeral: true,
        });

        client.channels.cache.get(LOG_CHANNEL_ID)?.send(
          `🔨 **Hardware Ban Added**\nUser ID: \`${userId}\`\nStaff: ${member.user.tag} (\`${member.id}\`)`
        );
        break;
      }

      case "unhardwareban": {
        if (!hardwareBans.includes(userId)) {
          return interaction.reply({
            content: "⚠️ That user is not hardware banned.",
            ephemeral: true,
          });
        }

        hardwareBans = hardwareBans.filter((id) => id !== userId);
        saveHardwareBans();

        interaction.reply({
          content: `🔓 Removed hardware ban for **${userId}**.`,
          ephemeral: true,
        });

        client.channels.cache.get(LOG_CHANNEL_ID)?.send(
          `🔓 **Hardware Ban Removed**\nUser ID: \`${userId}\`\nStaff: ${member.user.tag} (\`${member.id}\`)`
        );
        break;
      }

      case "hardwarebanlist": {
        return interaction.reply({
          content:
            hardwareBans.length === 0
              ? "📜 No users are currently hardware banned."
              : `📜 **Hardware-Banned Users:**\n${hardwareBans
                  .map((id) => `• \`${id}\``)
                  .join("\n")}`,
          ephemeral: true,
        });
      }
    }
  } catch (err) {
    console.error("❌ Error handling command:", err);
    if (!interaction.replied && !interaction.deferred) {
      interaction.reply({
        content: "❌ An error occurred while running that command.",
        ephemeral: true,
      });
    }
  }
});

// ---------- LOGIN ----------
client
  .login(process.env.SECURITY_BOT_TOKEN)
  .then(() => console.log("✅ Logged in to Discord."))
  .catch((err) => console.error("❌ Login failed:", err));
