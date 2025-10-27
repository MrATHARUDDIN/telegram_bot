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
  const json = JSON.parse(data);
  return json.matches;
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


// === User predictions ===
const userStates = {};

bot.onText(/\/prediction/, async (msg) => {
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
      return bot.sendMessage(chatId, "No upcoming matches available for prediction ⚽");
    }

    // Save user state
    userStates[chatId] = { step: "choose_match", matches: upcoming };

    // Show upcoming matches as numbered list
    const matchList = upcoming
      .map((m, i) => `${i + 1}. ${m.homeTeam} vs ${m.awayTeam} (${m.date})`)
      .join("\n");

    bot.sendMessage(
      chatId,
      `🔮 Choose a match to predict by sending its number:\n\n${matchList}`
    );
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "Error loading matches ❌");
  }
});

// Handle user replies (match selection + prediction)
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  const state = userStates[chatId];
  if (!state) return; // not in prediction mode

  // Step 1 — user chooses a match
  if (state.step === "choose_match") {
    const index = parseInt(text) - 1;
    if (isNaN(index) || index < 0 || index >= state.matches.length) {
      return bot.sendMessage(chatId, "❌ Invalid choice. Please send a valid match number.");
    }

    state.selectedMatch = state.matches[index];
    state.step = "enter_score";

    return bot.sendMessage(
      chatId,
      `You selected:\n${state.selectedMatch.homeTeam} vs ${state.selectedMatch.awayTeam}\n\nNow send your prediction like this:\n\n2-1`
    );
  }

  // Step 2 — user enters score
  if (state.step === "enter_score") {
    const parts = text.split("-");
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
      return bot.sendMessage(chatId, "❌ Please enter a valid score, e.g. 2-1");
    }

    const prediction = {
      user: msg.from.username || msg.from.first_name,
      match: `${state.selectedMatch.homeTeam} vs ${state.selectedMatch.awayTeam}`,
      date: state.selectedMatch.date,
      prediction: {
        home: parseInt(parts[0]),
        away: parseInt(parts[1]),
      },
    };

    try {
      // Read existing predictions
      let existing = [];
      try {
        const data = await fs.readFile("predictions.json", "utf8");
        existing = JSON.parse(data);
      } catch {
        existing = [];
      }

      // Save new prediction
      existing.push(prediction);
      await fs.writeFile("predictions.json", JSON.stringify(existing, null, 2));

      bot.sendMessage(
        chatId,
        `✅ Prediction saved:\n${prediction.match}\n${prediction.prediction.home} - ${prediction.prediction.away}`
      );
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "❌ Failed to save your prediction.");
    }
    // Clear user state
    delete userStates[chatId];
  }
});



app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
