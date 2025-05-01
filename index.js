import { Client, GatewayIntentBits, Partials, ActivityType, REST, Routes, SlashCommandBuilder } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import dgram from 'dgram';

dotenv.config();

const {
  DISCORD_BOT_TOKEN,
  WITHER_API_KEY,
  WITHER_SERVER_ID,
  STATUS_CHANNEL_ID,
  BEDROCK_SERVER_IP,
  BEDROCK_SERVER_PORT
} = process.env;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

let lastStatus = null;
let lastPlayerCount = 0;
let lastBackupTime = null;

const witherHeaders = {
  Authorization: WITHER_API_KEY,
  'Content-Type': 'application/json'
};

async function getWitherStatus() {
  try {
    const { data } = await axios.get(
      `https://panel.witherhosting.com/api/client/servers/${WITHER_SERVER_ID}`,
      { headers: witherHeaders }
    );
    return data.attributes.status;
  } catch {
    return 'offline';
  }
}

async function getLastBackup() {
  try {
    const { data } = await axios.get(
      `https://panel.witherhosting.com/api/client/servers/${WITHER_SERVER_ID}/backups`,
      { headers: witherHeaders }
    );
    return data.data[0]?.attributes.completed_at || data.data[0]?.attributes.created_at || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

function pingBedrockServer() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const pingBuffer = Buffer.from([
      0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]);

    let timeout = setTimeout(() => {
      client.close();
      resolve({ online: false });
    }, 2000);

    client.send(pingBuffer, 0, pingBuffer.length, BEDROCK_SERVER_PORT, BEDROCK_SERVER_IP, () => {});

    client.on('message', (msg) => {
      clearTimeout(timeout);
      const data = msg.toString('utf8').split(';');
      const playersOnline = parseInt(data[4]);
      const maxPlayers = parseInt(data[5]);
      client.close();
      resolve({
        online: true,
        motd: data[1],
        playersOnline,
        maxPlayers
      });
    });
  });
}

async function pollStatus() {
  const channel = await client.channels.fetch(STATUS_CHANNEL_ID);

  const status = await getWitherStatus();
  if (status !== lastStatus) {
    lastStatus = status;
    await channel.send(status === 'running' ? '✅ **Server is ONLINE**' : '🔴 **Server is OFFLINE**');
  }

  const backupTime = await getLastBackup();
  if (backupTime !== lastBackupTime) {
    lastBackupTime = backupTime;
    await channel.send(`💾 **New backup created at:** \`${backupTime}\``);
  }

  const ping = await pingBedrockServer();
  if (!ping.online) {
    await client.user.setPresence({
      activities: [{ name: '🔴 Offline', type: ActivityType.Playing }],
      status: 'dnd'
    });
    return;
  }

  if (ping.playersOnline !== lastPlayerCount) {
    lastPlayerCount = ping.playersOnline;
    await channel.send(`👥 **${ping.playersOnline} player(s) online.**`);
  }

  await client.user.setPresence({
    activities: [{ name: `🟢 ${ping.playersOnline} online`, type: ActivityType.Playing }],
    status: 'online'
  });
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  setInterval(pollStatus, 60_000);
  await client.application.commands.set([
    new SlashCommandBuilder().setName('status').setDescription('Check if the server is online.'),
    new SlashCommandBuilder().setName('backup').setDescription('Get the last backup time.'),
    new SlashCommandBuilder().setName('players').setDescription('See how many players are online.'),
    new SlashCommandBuilder().setName('ip').setDescription('Get the server IP and port.')
  ]);
  pollStatus();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'status') {
    const status = await getWitherStatus();
    await interaction.reply(`Server status: **${status.toUpperCase()}**`);
  }

  if (interaction.commandName === 'backup') {
    const backupTime = await getLastBackup();
    await interaction.reply(`🕒 Last backup: \`${backupTime}\``);
  }

  if (interaction.commandName === 'players') {
    const ping = await pingBedrockServer();
    if (!ping.online) return interaction.reply('❌ Server is offline or unreachable.');
    await interaction.reply(`👥 Players: **${ping.playersOnline} / ${ping.maxPlayers}**`);
  }

  if (interaction.commandName === 'ip') {
    await interaction.reply(`🌐 IP: \`${BEDROCK_SERVER_IP}\`
📡 Port: \`${BEDROCK_SERVER_PORT}\``);
  }
});

client.login(DISCORD_BOT_TOKEN);