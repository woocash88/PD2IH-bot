const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  SlashCommandBuilder, MessageFlags,
} = require('discord.js');

// Prywatny kanał administratorski, na którym lądują zgłoszenia (każde jako osobny wątek)
const FEEDBACK_CHANNEL_ID = process.env.FEEDBACK_CHANNEL_ID || '968120859824893952';
const FEEDBACK_ADMIN_IDS = ['206928136980398081', '529820348775006229'];

const BUTTON_ID = 'feedback';
const MODAL_ID = 'modalfeedback';
const INPUT_ID = 'feedbackinput';

const command = new SlashCommandBuilder()
  .setName('feedback')
  .setDescription('Wysyła panel, przez który można napisać do administracji')
  .toJSON();

const buttonRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(BUTTON_ID).setLabel('Napisz do nas').setEmoji('💬').setStyle(ButtonStyle.Success)
);

const ICON = 'pd2ih_32x32.png';
const THUMB = 'riki.png';

async function handleCommand(interaction) {
  const files = [ICON, THUMB]
    .filter(f => fs.existsSync(path.join(__dirname, f)))
    .map(f => new AttachmentBuilder(path.join(__dirname, f), { name: f }));
  const has = (f) => files.some(a => a.name === f);

  const embed = new EmbedBuilder()
    .setAuthor({ name: 'Feedback', ...(has(ICON) && { iconURL: `attachment://${ICON}` }) })
    .setDescription(
      '🔰 Czekamy na Twój feedback! Daj znać co myślisz na temat Polskiej Ligi Dota, Party Findera, moderacji lub po prostu opinię na dowolny temat.\n\n' +
      'Jesteśmy otwarci na zmiany, sugestie lub skargi, dlatego czekamy na Wasze opinie! Piszcie śmiało! 🤩'
    )
    .setColor(0xFF0000);
  if (has(THUMB)) embed.setThumbnail(`attachment://${THUMB}`);

  await interaction.channel.send({ embeds: [embed], components: [buttonRow()], files });
  return interaction.reply({ content: 'Panel wysłany!', flags: [MessageFlags.Ephemeral] });
}

function showModal(interaction) {
  const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle('Napisz do nas');
  const input = new TextInputBuilder()
    .setCustomId(INPUT_ID).setLabel('Twoja wiadomość (max 1000 znaków)')
    .setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

// Numer zgłoszenia zapisywany w pliku, żeby przetrwał restart bota.
// Odczyt i zapis są synchroniczne, więc równoległe zgłoszenia nie dostaną tego samego numeru.
const COUNTER_FILE = path.join(__dirname, 'feedback_counter.json');
function nextFeedbackNumber() {
  let last = 0;
  try { last = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')).last || 0; } catch {}
  const next = last + 1;
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ last: next }));
  return next;
}

async function handleModal(interaction, logEvent) {
  const userTag = interaction.user.tag;
  const text = interaction.fields.getTextInputValue(INPUT_ID).trim();
  if (!text) return interaction.reply({ content: '❌ Wiadomość jest pusta.', flags: [MessageFlags.Ephemeral] });

  try {
    const channel = await interaction.client.channels.fetch(FEEDBACK_CHANNEL_ID);
    const name = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

    const num = nextFeedbackNumber();
    const header = await channel.send({ content: `📩 Feedback **#${num}** od **${name}** (<@${interaction.user.id}>)` });
    const thread = await header.startThread({
      name: `Feedback #${num} ${name}`.slice(0, 100),
      autoArchiveDuration: 10080,
    });
    await thread.send({
      content: `${FEEDBACK_ADMIN_IDS.map(id => `<@${id}>`).join(' ')}\n**Feedback #${num}**\n**Od:** ${name} (${userTag}, ID: ${interaction.user.id})\n\n${text}`,
      allowedMentions: { users: FEEDBACK_ADMIN_IDS },
    });

    logEvent('FEEDBACK_SENT', userTag, `number=${num} length=${text.length}`);
    return interaction.reply({ content: '✅ Dziękujemy za wiadomość!', flags: [MessageFlags.Ephemeral] });
  } catch (err) {
    logEvent('FEEDBACK_FAILED', userTag, String(err.message || err));
    return interaction.reply({ content: '❌ Nie udało się wysłać wiadomości. Spróbuj później.', flags: [MessageFlags.Ephemeral] });
  }
}

module.exports = { command, BUTTON_ID, MODAL_ID, handleCommand, showModal, handleModal, buttonRow };
