// ============================
// EXPRESS KEEP-ALIVE SERVER
// ============================
const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("Softban Security Bot is running."));
app.listen(process.env.PORT || 3000);

// ============================
// DISCORD SECURITY BOT
// ============================
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  REST,
  PermissionFlagsBits
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// ============================
// CONFIG
// ============================
const OWNER_ID = "1350882351743500409";
const STAFF_ROLE_ID = "1381268070248484944";
const LOG_CHANNEL_ID = "1439268049806168194";

// ============================
// SOFTBAN DATABASE (in-memory)
// ============================
let softbanned = new Set();

// ============================
// HELPER: PERMISSION CHECK
// ============================
function hasPermission(member) {
  return (
    member.id === OWNER_ID ||
    member.roles.cache.has(STAFF_ROLE_ID)
  );
}

// ============================
// COMMAND REGISTRATION
// ============================
const commands = [
  new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Softbans a user (ban + instant unban).")
    .addUserOption(option => option.setName("user").setDescription("User to softban").setRequired(true))
    .addStringOption(option => option.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Remove a user from the softban list.")
    .addUserOption(option => option.setName("user").setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("checkban")
    .setDescription("Check if a user is softbanned.")
    .addUserOption(option => option.setName("user").setDescription("User").setRequired(true)),
].map(cmd => cmd.toJSON());

// Register commands
const rest = new REST({ version: "10" }).setToken(process.env.SOFTBAN_TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("Commands registered.");
  } catch (err) {
    console.error(err);
  }
})();

// ============================
// MAIN BOT EVENTS
// ============================
client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ============================
// SOFTBAN COMMAND
// ============================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, guild } = interaction;

  if (!hasPermission(member)) {
    return interaction.reply({ content: "❌ You do not have permission.", ephemeral: true });
  }

  if (commandName === "softban") {
    const target = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason provided.";

    try {
      await guild.members.ban(target.id, { deleteMessageSeconds: 604800, reason });
      await guild.members.unban(target.id);

      softbanned.add(target.id);

      const log = guild.channels.cache.get(LOG_CHANNEL_ID);
      if (log) {
        log.send(`🔨 **Softban Executed**  
**User:** <@${target.id}>  
**By:** <@${interaction.user.id}>  
**Reason:** ${reason}`);
      }

      return interaction.reply(`✅ Successfully softbanned **${target.tag}**.`);
    } catch (err) {
      console.error(err);
      return interaction.reply("❌ Error softbanning user.");
    }
  }

  // ============================
  // UNBAN COMMAND
  // ============================
  if (commandName === "unban") {
    const target = interaction.options.getUser("user");

    if (softbanned.has(target.id)) {
      softbanned.delete(target.id);

      const log = guild.channels.cache.get(LOG_CHANNEL_ID);
      if (log) log.send(`🔓 **Softban Removed**  
**User:** <@${target.id}>  
**By:** <@${interaction.user.id}>`);

      return interaction.reply(`✅ Removed **${target.tag}** from softban list.`);
    } else {
      return interaction.reply("❌ This user is NOT softbanned.");
    }
  }

  // ============================
  // CHECKBAN COMMAND
  // ============================
  if (commandName === "checkban") {
    const target = interaction.options.getUser("user");
    const isBanned = softbanned.has(target.id);

    return interaction.reply(
      isBanned
        ? `🟥 **${target.tag} is softbanned.**`
        : `🟩 **${target.tag} is NOT softbanned.**`
    );
  }
});

// ============================
// AUTO-KICK IF SOFTBANNED USER REJOINS
// ============================
client.on("guildMemberAdd", member => {
  if (softbanned.has(member.id)) {
    member.kick("Softbanned user rejoined.");

    const log = member.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (log) {
      log.send(`🚫 **Auto-Kick Triggered**  
A softbanned user tried to rejoin.  
User: <@${member.id}>`);
    }
  }
});

// ============================
// LOGIN
// ============================
client.login(process.env.SOFTBAN_TOKEN);
