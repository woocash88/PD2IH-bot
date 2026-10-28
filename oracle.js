const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { GoogleGenAI } = require('@google/genai');
const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const { GEMINI_API_KEY, ALLOWED_CHANNELS = '', GEMINI_MODEL = 'gemini-3.5-flash' } = process.env;

const allowedChannels = new Set(ALLOWED_CHANNELS.split(',').map(s => s.trim()).filter(Boolean));
const enabled = Boolean(GEMINI_API_KEY) && allowedChannels.size > 0;

let db = null;
let genai = null;
if (enabled) {
  db = new DatabaseSync(path.join(__dirname, 'chat_history.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      channel_id  TEXT    NOT NULL,
      author_id   TEXT,
      author      TEXT    NOT NULL,
      content     TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages (channel_id, timestamp);
  `);
  genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
} else {
  console.warn('⚠️ Oracle wyłączony: brak GEMINI_API_KEY lub ALLOWED_CHANNELS w .env');
}

const DELIMITER = '===PART2===';

const command = new SlashCommandBuilder()
  .setName('podsumowanie')
  .setDescription('Generuje podsumowanie czatu z ostatnich X dni.')
  .addIntegerOption(o => o.setName('days').setDescription('Liczba dni wstecz (domyślnie 1)').setMinValue(1).setMaxValue(30))
  .addChannelOption(o => o.setName('channel').setDescription('Kanał do podsumowania (domyślnie bieżący)'))
  .addStringOption(o => o.setName('spice').setDescription('Styl podsumowania (domyślnie standard)').addChoices(
    { name: 'Standard', value: 'standard' },
    { name: 'Satyryczny / Roast', value: 'roast' },
    { name: 'Ostre / Bez Cenzury', value: 'unfiltered' },
  ))
  .addUserOption(o => o.setName('user').setDescription('Opcjonalnie: podsumuj tylko wypowiedzi wybranego użytkownika'))
  .toJSON();

function buildPrompt(spice, targetUser) {
  let base;
  if (targetUser) {
    base =
      `Analyze the following messages sent by the user **${targetUser.displayName ?? targetUser.username}** (${targetUser.username}) ` +
      'and create a personal summary of their chat activity in Polish.\n\n' +
      'Format requirements:\n' +
      '**1. Główne tematy i wypowiedzi**\n' +
      'Summarize what they were talking about or complaining/excited about.\n\n' +
      '**2. Styl komunikacji i nastawienie**\n' +
      'Describe their vibe, tone, and overall presence in the chat.\n\n' +
      `Keep the entire response under 1800 characters. Do NOT include the ${DELIMITER} delimiter.`;
  } else {
    base =
      'Analyze the following chat log and create a summary in Polish strictly divided into 4 specific points, ' +
      `separated into two parts by the delimiter ${DELIMITER}.\n\n` +
      'Your output format MUST strictly follow this layout:\n\n' +
      '**1. Główny temat**\n' +
      'Write the main topic text here in normal font.\n\n' +
      '**2. Aktywni użytkownicy**\n' +
      '- User 1: short description\n' +
      '- User 2: short description\n\n' +
      `${DELIMITER}\n\n` +
      '**3. Kontrowersje**\n' +
      'Write the controversies text here in normal font.\n\n' +
      '**4. Ogólna atmosfera**\n' +
      'Write the general vibe text here in normal font.\n\n' +
      'Formatting Rules:\n' +
      '- Bold ONLY the section titles (e.g., **1. Główny temat**). The content under each title must be in standard, unbolded text.\n' +
      "- In section 2 (Aktywni użytkownicy), list the users strictly using bullet points with dashes ('-'), NOT numbered lists.\n" +
      '- Part 1 (points 1 & 2 before the delimiter) must stay under 1500 characters.\n' +
      '- Part 2 (points 3 & 4 after the delimiter) must stay under 1500 characters.\n' +
      `- Do NOT use the delimiter ${DELIMITER} anywhere else in the response.`;
  }

  const styles = {
    standard: 'Style requirement: Write an objective, neutral summary.',
    roast: 'Style requirement: Write a sarcastic, satirical summary. Roast the user(s) playfully.',
    unfiltered: 'Style requirement: Write a very edgy, unfiltered, highly sarcastic summary in Polish with profanity allowed. Treat it like a roast among close friends.',
  };
  return `${base}\n\n${styles[spice] || styles.standard}`;
}

function splitSummary(summary) {
  if (summary.includes(DELIMITER)) {
    const [a, b] = summary.split(DELIMITER, 2);
    return [a.trim(), b.trim()].filter(Boolean);
  }
  if (summary.length <= 1900) return [summary];
  let at = summary.lastIndexOf('\n', 1900);
  if (at === -1) at = summary.lastIndexOf('. ', 1900);
  if (at === -1) at = 1900;
  return [summary.slice(0, at + 1).trim(), summary.slice(at + 1).trim()].filter(Boolean);
}

function trackMessage(message) {
  if (!enabled || message.author.bot || !allowedChannels.has(message.channelId)) return;
  if (!message.content) return;
  try {
    db.prepare('INSERT INTO messages (timestamp, channel_id, author_id, author, content) VALUES (?, ?, ?, ?, ?)')
      .run(message.createdTimestamp, message.channelId, message.author.id, message.author.username, message.content);
  } catch (e) { console.error('Oracle insert error:', e); }
}

async function handlePodsumowanie(interaction) {
  if (!enabled) {
    return interaction.reply({ content: '❌ Funkcja podsumowań jest wyłączona (brak konfiguracji).', flags: [MessageFlags.Ephemeral] });
  }
  await interaction.deferReply();

  const days = interaction.options.getInteger('days') ?? 1;
  const target = interaction.options.getChannel('channel') ?? interaction.channel;
  const spice = interaction.options.getString('spice') ?? 'standard';
  const user = interaction.options.getUser('user');

  if (!allowedChannels.has(target.id)) {
    return interaction.editReply('❌ Ten kanał nie jest śledzony – nie mam dla niego historii wiadomości.');
  }

  const cutoff = Date.now() - days * 86400000;
  const rows = user
    ? db.prepare('SELECT timestamp, author, content FROM messages WHERE channel_id = ? AND timestamp >= ? AND (author_id = ? OR author = ?) ORDER BY timestamp ASC').all(target.id, cutoff, user.id, user.username)
    : db.prepare('SELECT timestamp, author, content FROM messages WHERE channel_id = ? AND timestamp >= ? ORDER BY timestamp ASC').all(target.id, cutoff);

  if (!rows.length) {
    return interaction.editReply(`Brak wiadomości w bazie danych dla ${user ? `użytkownika ${user}` : 'tego kanału'} w podanym okresie.`);
  }

  const chatLog = rows.map(r => `[${new Date(r.timestamp).toISOString()}] ${r.author}: ${r.content}`).join('\n');

  let summary;
  try {
    const response = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `${buildPrompt(spice, user)}\n\n${chatLog}`,
    });
    summary = response.text;
    if (!summary) throw new Error('Pusta odpowiedź modelu');
  } catch (e) {
    console.error('Oracle Gemini error:', e);
    return interaction.editReply(`❌ Wystąpił błąd podczas generowania podsumowania: ${e.message}`);
  }

  const [first, ...rest] = splitSummary(summary);
  await interaction.editReply(first);
  for (const part of rest) await interaction.followUp(part);
}

module.exports = { command, trackMessage, handlePodsumowanie };
