const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

// === CONFIG ===
const PORT = process.env.PORT || 4040;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8482145476:AAGnV_DR2vvERiwDDrSgd3HGnWjLFGEQPTE";

const app = express();
app.use(express.json());

// === TELEGRAM BOT ===
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// === Helper: read matches ===
async function readMatches() {
  const data = await fs.readFile("matches.json", "utf8");
  return JSON.parse(data);
}

// === Express routes ===
app.get("/", (req, res) => {
  res.send("GET request to the homepage");
});

app.get("/matches", async (req, res) => {
  try {
    const matches = await readMatches();
    res.json(matches);
  } catch (error) {
    console.error("Error reading matches.json:", error);
    res.status(500).json({ error: "Failed to load match data." });
  }
});

// === Telegram Commands ===

// /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Welcome! ⚽\n\nUse:\n/upcoming - see matches for next 7 days\n/finished - see last week's matches"
  );
});

bot.onText(/\/upcoming/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const matches = await readMatches();

    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);

    const upcoming = matches.filter((m) => {
      const matchDate = new Date(m.date);
      return matchDate >= now && matchDate <= nextWeek && m.status === "UPCOMING";
    });

    if (upcoming.length === 0) {
      return bot.sendMessage(chatId, "No upcoming matches in the next 7 days ⚽");
    }

    const message = upcoming
      .map(
        (m) =>
          `🏟️ ${m.homeTeam} vs ${m.awayTeam}\n📅 ${m.date}\n📍 ${m.homeFlag} vs ${m.awayFlag}`
      )
      .join("\n\n");

    bot.sendMessage(chatId, message);
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "Error loading upcoming matches ❌");
  }
});


bot.onText(/\/finished/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const matches = await readMatches();

    const now = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(now.getDate() - 7);

    const finished = matches.filter((m) => {
      const matchDate = new Date(m.date);
      return matchDate >= lastWeek && matchDate <= now && m.status === "FINISHED";
    });

    if (finished.length === 0) {
      return bot.sendMessage(chatId, "No finished matches in the last week 🏁");
    }

    const message = finished
      .map(
        (m) =>
          `✅ ${m.homeTeam} vs ${m.awayTeam}\n📅 ${m.date}\n🏁 ${m.homeFlag} ${m.score.home} - ${m.score.away} ${m.awayFlag}`
      )
      .join("\n\n");

    bot.sendMessage(chatId, message);
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "Error loading finished matches ❌");
  }
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
