// ============================
// EXPRESS KEEP-ALIVE SERVER
// ============================
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("✅ Softban Bot is running!");
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ============================
// DISCORD.JS SOFTBAN BOT
// ============================
const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

// ---- CONFIG ----
const OWNER_ID = "1350882351743500409";          // you
const STAFF_ROLE_ID = "1381268070248484944";     // staff role that can use commands
const GUILD_ID = "1381002127765278740";          // your main server

const BANS_FILE = path.join(__dirname, "bans.json");

// ---- LOAD / SAVE BANS ----
let bans = {}; // { userId: { reason, addedBy, addedAt } }

function loadBans() {
  try {
    if (fs.existsSync(BANS_FILE)) {
      const raw = fs.readFileSync(BANS_FILE, "utf8");
      bans = JSON.parse(raw);
      console.log(`📁 Loaded ${Object.keys(bans).length} softbans from bans.json`);
    } else {
      bans = {};
      console.log("📁 bans.json not found, starting with empty ban list.");
    }
  } catch (err) {
    console.error("❌ Error loading bans.json, starting fresh:", err);
    bans = {};
  }
}

function saveBans() {
  try {
    fs.writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2), "utf8");
  } catch (err) {
    console.error("❌ Error saving bans.json:", err);
  }
}

// ---- PERMISSION CHECK ----
function canUse(interaction) {
  if (interaction.user.id === OWNER_ID) return true;
  const member = interaction.member;
  if (!member || !member.roles) return false;
  return member.roles.cache.has(STAFF_ROLE_ID);
}

// ---- DISCORD CLIENT ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // needed for join events + role checks
  ],
  partials: [Partials.GuildMember],
});

// ---- SLASH COMMAND DEFINITIONS ----
const softbanCommand = new SlashCommandBuilder()
  .setName("softban")
  .setDescription("Software ban system (only owner + staff role).")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Softban a user (they get kicked when they join).")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("User to softban")
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Reason for the softban")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove a softban from a user.")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("User to remove from softban list")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("List current softbanned users.")
  );

// ---- READY EVENT ----
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  loadBans();

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await client.application.commands.set([softbanCommand.toJSON()], guild.id);
    console.log("🌐 Registered /softban command in guild:", guild.name);
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
});

// ---- MEMBER JOIN: ENFORCE SOFTBANS ----
client.on("guildMemberAdd", async (member) => {
  try {
    if (member.guild.id !== GUILD_ID) return;

    if (bans[member.id]) {
      const reason = bans[member.id].reason || "Softbanned from this server";

      console.log(`🚫 Softbanned user joined: ${member.user.tag} (${member.id}) – kicking.`);

      try {
        await member.send(
          `🚫 You are **softbanned** from **${member.guild.name}**.\nReason: **${reason}**`
        ).catch(() => {});
      } catch {
        // ignore DM errors
      }

      await member.kick(`Softbanned: ${reason}`).catch((err) => {
        console.error("❌ Failed to kick softbanned user:", err);
      });
    }
  } catch (err) {
    console.error("❌ Error in guildMemberAdd handler:", err);
  }
});

// ---- INTERACTIONS: /softban ----
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "softban") return;

  if (!canUse(interaction)) {
    await interaction.reply({
      content: "❌ You don't have permission to use this command.",
      ephemeral: true,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "add") {
    const user = interaction.options.getUser("user", true);
    const reason =
      interaction.options.getString("reason") || "No reason provided";

    if (bans[user.id]) {
      await interaction.reply({
        content: `⚠️ ${user.tag} is **already softbanned**.\nReason: **${bans[user.id].reason}**`,
        ephemeral: true,
      });
      return;
    }

    bans[user.id] = {
      reason,
      addedBy: interaction.user.id,
      addedAt: new Date().toISOString(),
    };
    saveBans();

    // If they are in the server right now, kick them
    const guild = interaction.guild;
    let member = null;
    try {
      member = await guild.members.fetch(user.id);
    } catch {
      member = null;
    }

    if (member) {
      try {
        await member.send(
          `🚫 You have been **softbanned** from **${guild.name}**.\nReason: **${reason}**`
        ).catch(() => {});
      } catch {}
      await member.kick(`Softbanned: ${reason}`).catch((err) =>
        console.error("❌ Failed to kick on /softban add:", err)
      );
    }

    await interaction.reply({
      content: `✅ Softbanned **${user.tag}**.\nReason: **${reason}**`,
      ephemeral: false,
    });

  } else if (sub === "remove") {
    const user = interaction.options.getUser("user", true);

    if (!bans[user.id]) {
      await interaction.reply({
        content: `❌ ${user.tag} is **not** softbanned.`,
        ephemeral: true,
      });
      return;
    }

    delete bans[user.id];
    saveBans();

    await interaction.reply({
      content: `✅ Removed softban for **${user.tag}**.`,
      ephemeral: false,
    });

  } else if (sub === "list") {
    const entries = Object.entries(bans);

    if (entries.length === 0) {
      await interaction.reply({
        content: "✅ There are **no softbanned users**.",
        ephemeral: true,
      });
      return;
    }

    const lines = entries.slice(0, 20).map(([userId, info]) => {
      const reason = info.reason || "No reason";
      const addedAt = info.addedAt || "Unknown time";
      return `• <@${userId}> (\`${userId}\`) — **${reason}** *(since ${addedAt})*`;
    });

    let msg = "**Softbanned users:**\n" + lines.join("\n");
    if (entries.length > 20) {
      msg += `\n…and **${entries.length - 20}** more.`;
    }

    await interaction.reply({
      content: msg,
      ephemeral: false,
    });
  }
});

// ---- LOGIN WITH SAFE TOKEN HANDLING ----
const token =
  process.env.SOFTBAN_BOT_TOKEN ||
  process.env.BOT_TOKEN ||
  process.env.DISCORD_TOKEN;

if (!token) {
  console.error("❌ No Discord bot token found in environment variables!");
  process.exit(1);
}

client
  .login(token)
  .then(() => console.log("✅ Softban bot logged in successfully."))
  .catch((err) => {
    console.error("❌ Login failed! Check your token/env variable.");
    console.error(err);
    process.exit(1);
  });
