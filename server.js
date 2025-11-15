// ==========================================
//  SECURITY BOT v2 — FIXED + REBUILT CLEAN
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ---------- CONFIG ----------
const OWNER_ID = "1350882351743500409";

const STAFF_ROLES = [
  "1397546010317684786",
  "1381268185671667732",
  "1381268072828112896",
  "1381268070248484944"
];

const LOG_CHANNEL_ID = "1439268049806168194";

let softbannedUsers = new Set(); // stores softbanned user IDs

// ---------- PERMISSION CHECK ----------
function hasPermission(member) {
  if (!member) return false;

  if (member.id === OWNER_ID) return true;

  return member.roles.cache.some(r => STAFF_ROLES.includes(r.id));
}

// ---------- SLASH COMMANDS ----------
const commands = [
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
    .setDescription("Shows all softbanned users.")
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

// ---------- EVENT: MEMBER JOIN ----------
client.on("guildMemberAdd", async (member) => {
  if (softbannedUsers.has(member.id)) {
    await member.kick("User is softbanned.");

    const log = member.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (log) {
      log.send(`🚫 **Softbanned user attempted to join:** ${member.user.tag} (\`${member.id}\`)`);
    }
  }
});

// ---------- EVENT: SLASH COMMAND ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, options } = interaction;

  if (!hasPermission(member)) {
    return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
  }

  const userId = options.getString("userid");

  switch (commandName) {
    case "softban":
      softbannedUsers.add(userId);

      interaction.reply({
        content: `🔒 User **${userId}** has been **SOFTBANNED**.`,
        ephemeral: true
      });

      client.channels.cache.get(LOG_CHANNEL_ID)?.send(
        `🚫 **Softban Added**  
        User ID: \`${userId}\`  
        Staff: ${member.user.tag} (${member.id})`
      );

      break;

    case "unsoftban":
      if (!softbannedUsers.has(userId)) {
        return interaction.reply({ content: "❌ This user is not softbanned.", ephemeral: true });
      }

      softbannedUsers.delete(userId);

      interaction.reply({
        content: `🔓 User **${userId}** has been **UN-SOFTBANNED**.`,
        ephemeral: true
      });

      client.channels.cache.get(LOG_CHANNEL_ID)?.send(
        `🔓 **Softban Removed**  
        User ID: \`${userId}\`  
        Staff: ${member.user.tag}`
      );
      break;

    case "softbanlist":
      const list = [...softbannedUsers].join("\n") || "No users softbanned.";

      interaction.reply({
        content: `📜 **Softbanned Users:**\n${list}`,
        ephemeral: true
      });
      break;
  }
});

// ---------- LOGIN ----------
client.login(process.env.SECURITY_BOT_TOKEN);
