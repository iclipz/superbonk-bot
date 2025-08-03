# 🔥⚔️ SUPERBONK Battle Royale Telegram Bot

A chaotic Telegram bot for group chats where users can start or join epic "BONK Battle Royales" with multiple participants fighting until only one survives!

## 🚀 Quick Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create a Telegram bot:**
   - Message @BotFather on Telegram
   - Use `/newbot` command
   - Choose a name and username for your bot
   - Copy the bot token

3. **Create `.env` file:**
   ```bash
   BOT_TOKEN=your_telegram_bot_token_here
   ```

4. **Run the bot:**
   ```bash
   npm start
   ```

## 🎮 Commands

- **`/bonk`** - Start or join a BONK Battle Royale
- **`/leaderboard`** - View the group's top battle survivors
- **`/bonkstats [@username]`** - View battle statistics
- **`/help`** - Show all commands

## 🔥 How It Works

1. **Start a battle** with `/bonk` - you're the first fighter!
2. **Others join** by typing `/bonk` within 30 seconds
3. **More fighters = lower individual win chance but MORE CHAOS!**
4. **Battle starts** automatically when time expires or enough people join
5. **Random elimination** each round until only 1 survivor remains
6. **5% chance for MEGA BONK** chaos events!
7. **Winner gets +1 victory** and continues their streak
8. **The more participants, the more epic the victory!**

## 📊 Features

- ✅ **Battle Royale system** - multiple participants, one winner
- ✅ **Dynamic elimination** - more players = more chaos
- ✅ **30-second join window** with auto-start
- ✅ **Per-group leaderboards** with persistent JSON storage
- ✅ **Prevents multiple battles** in same group simultaneously
- ✅ **Epic battle messages** for eliminations and victories
- ✅ **MEGA BONK chaos events** (5% chance, double points)
- ✅ **Win streaks and detailed statistics**
- ✅ **Group chat only** (not private messages)

## 🎯 Example Usage

```
User1: /bonk
Bot: 🔥⚔️ @User1 wants to start a BONK BATTLE ROYALE! ⚔️🔥
     💀 Type /bonk to join the chaos!
     ⏰ Battle starts in 30 seconds or when more fighters join!

User2: /bonk
Bot: ⚔️ @User2 joins the BONK battle! ⚔️
     🎯 Current fighters (2): @User1, @User2
     ⏰ Battle starts in 10 seconds or when someone else joins!

User3: /bonk
User4: /bonk
Bot: 🔥⚔️ SUPERBONK BATTLE ROYALE STARTING! ⚔️🔥
     💀 FIGHTERS: @User1, @User2, @User3, @User4
     🎯 4 BONKERS enter... only 1 survives!

Bot: ⚔️ ROUND 1 ⚔️
     @User3 has been BONKED out of the battle! 💀
     💀 1 eliminated! 3 BONKERS remain!

Bot: ⚔️ ROUND 2 ⚔️
     💥🔥 MEGA BONK ACTIVATED! 🔥💥 Multiple BONKERS get obliterated! ⚡⚡⚡
     @User2 got REKT and eliminated! ⚰️
     💀 1 eliminated! 2 BONKERS remain!

Bot: 🏆⚔️ BATTLE ROYALE COMPLETE! ⚔️🏆
     👑 @User1 reigns supreme in this BONK battle! 👑
     🎉 Victory earned! +1 win! 🎉
```

## 📁 File Structure

- `index.js` - Main bot code
- `package.json` - Dependencies and scripts
- `bonk_data.json` - Auto-generated storage file (per-group data)
- `.env` - Your bot token (create this file)

## 🛠️ Technical Details

- Built with Node.js and Telegraf
- JSON file storage for persistence
- In-memory state management for active duels
- Group-specific leaderboards
- Timeout handling for challenges
- Error handling and graceful shutdowns

Ready to start the ultimate BONK BATTLE ROYALE! ⚔️💀⚡