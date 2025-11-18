// ==========================================
//  BLOX & CO SECURITY BOT v5
//  - Softban + Hardware Ban
//  - Lookup Command
//  - Full Command Logging
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
});

// ---------- AUTO-KICK ----------
client.on("guildMemberAdd", async (member) => {
  const log = member.guild.channels.cache.get(LOG_CHANNEL_ID);

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

// ---------- LOGIN ----------
client.login(process.env.SECURITY_BOT_TOKEN);
