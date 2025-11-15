// ============================
// EXPRESS KEEP-ALIVE SERVER
// ============================
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🛡️ Blox & Co Security Bot is running!");
});

app.listen(PORT, () =>
  console.log(`🌐 Web server running on port ${PORT}`)
);

// ============================
// DISCORD SECURITY BOT
// ============================
const {
  Client,
  GatewayIntentBits,
  Events,
  PermissionFlagsBits,
} = require("discord.js");

// ===== CONFIG =====
const TOKEN = process.env.SECURITY_BOT_TOKEN;
const OWNER_ID = "1350882351743500409"; // YOU
const STAFF_ROLE = "1381268070248484944"; // Allowed staff
const LOG_CHANNEL = "1439268049806168194"; // Log channel
const GUILD_ID = "1381002127765278740"; // Your guild

// ===== CREATE BOT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// ============ PERMISSION CHECK ============
function canUseCommand(member) {
  return (
    member.id === OWNER_ID ||
    member.roles.cache.has(STAFF_ROLE)
  );
}

// ============================
// BOT READY → Register Commands instantly
// ============================
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);

  const commands = [
    {
      name: "softban",
      description: "Soft-ban a user (ban + delete 7 days messages).",
      options: [
        {
          name: "user",
          description: "Select the user to softban",
          type: 6,
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

  // REGISTER (*GUILD COMMANDS → INSTANT APPEARANCE*)
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
      await guild.commands.set(commands);
      console.log("⚡ Slash commands registered instantly (guild mode).");
    } else {
      console.log("❌ Guild not found, commands NOT registered.");
    }
  } catch (e) {
    console.log("❌ Command registration error:", e);
  }
});

// ============================
// COMMAND HANDLER
// ============================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;

  // Unauthorized attempt
  if (!canUseCommand(member)) {
    return interaction.reply({
      content: "❌ You are **not authorized** to use this command.",
      ephemeral: true,
    });
  }

  // Logging channel
  const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL);

  // ============================
  // /securityping
  // ============================
  if (interaction.commandName === "securityping") {
    return interaction.reply({
      content: "🛡️ Blox & Co Security Bot is **online & protecting the server**.",
      ephemeral: true,
    });
  }

  // ============================
  // /softban
  // ============================
  if (interaction.commandName === "softban") {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason provided";

    try {
      const memberToBan = await interaction.guild.members.fetch(user.id);

      await memberToBan.ban({
        deleteMessageSeconds: 7 * 24 * 60 * 60,
        reason: reason,
      });

      await interaction.reply(`🔨 **Softbanned:** ${user.tag}\n📄 **Reason:** ${reason}`);

      if (logChannel)
        logChannel.send(`🛡️ **Softban executed**\n👤 User: ${user.tag}\n📝 Reason: ${reason}\n👮 By: ${interaction.user.tag}`);
    } catch (err) {
      console.log(err);
      return interaction.reply({
        content: "❌ Failed to softban the user.",
        ephemeral: true,
      });
    }
  }

  // ============================
  // /unban
  // ============================
  if (interaction.commandName === "unban") {
    const userid = interaction.options.getString("userid");
    const reason = interaction.options.getString("reason") || "No reason provided";

    try {
      await interaction.guild.bans.remove(userid, reason);

      await interaction.reply(`🔓 **Unbanned:** ${userid}`);

      if (logChannel)
        logChannel.send(`🛡️ **Unban executed**\n👤 User ID: ${userid}\n📝 Reason: ${reason}\n👮 By: ${interaction.user.tag}`);
    } catch (err) {
      console.log(err);
      return interaction.reply({
        content: "❌ Failed to unban that user ID.",
        ephemeral: true,
      });
    }
  }
});

// ============================
// LOGIN
// ============================
client.login(TOKEN);
