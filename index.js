// SUPERBONK Telegram Bot
// 
// Installation Instructions:
// 1. npm init -y
// 2. npm install telegraf dotenv
// 3. Create .env file with: BOT_TOKEN=your_telegram_bot_token_here
// 4. node index.js
//
// Features:
// - 1v1 BONK duels (best 2 out of 3)
// - Per-group leaderboards with JSON persistence
// - Meme messages and MEGA BONK special events
// - Challenge timeouts and duel state management

const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Storage file path
const STORAGE_FILE = path.join(__dirname, 'bonk_data.json');

// Active battle royales tracker (in-memory)
const activeBattles = new Map(); // groupId -> { participants: [], startTime, battleState }

// Battle Royale messages
const BATTLE_ROYALE_MESSAGES = [
    "💥 @{winner} emerges victorious from the BONK chaos! 💥",
    "🏆 @{winner} is the last BONKER standing! 🏆",
    "⚡ @{winner} BONKED their way to victory! ⚡",
    "🔥 @{winner} dominated the BONK battlefield! 🔥",
    "🎯 @{winner} proves they're the ultimate BONKER! 🎯",
    "👑 @{winner} reigns supreme in this BONK battle! 👑"
];

const ELIMINATION_MESSAGES = [
    "@{eliminated} has been BONKED out of the battle! 💀",
    "@{eliminated} couldn't handle the BONK pressure! 😵",
    "@{eliminated} got REKT and eliminated! ⚰️",
    "@{eliminated} was BONKED into oblivion! 💥",
    "@{eliminated} has left the battlefield! 🚪💨"
];

const MEGA_BONK_MESSAGES = [
    "💥🔥 MEGA BONK ACTIVATED! 🔥💥 Multiple BONKERS get obliterated! ⚡⚡⚡",
    "🌟✨ LEGENDARY MEGA BONK! ✨🌟 The battlefield trembles! 👻🔨💀",
    "🚀💥 ULTRA MEGA BONK! 💥🚀 Chaos erupts in the arena! 🛸🌍"
];

// Load or create storage
function loadStorage() {
    try {
        if (fs.existsSync(STORAGE_FILE)) {
            return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading storage:', error);
    }
    return {};
}

// Save storage
function saveStorage(data) {
    try {
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving storage:', error);
    }
}

// Get or create user data
function getUserData(groupId, userId, username) {
    const storage = loadStorage();
    
    if (!storage[groupId]) {
        storage[groupId] = {};
    }
    
    if (!storage[groupId][userId]) {
        storage[groupId][userId] = {
            username: username || 'Unknown',
            wins: 0,
            losses: 0,
            streak: 0
        };
    } else {
        // Update username if provided
        if (username) {
            storage[groupId][userId].username = username;
        }
    }
    
    saveStorage(storage);
    return storage[groupId][userId];
}

// Update user stats
function updateUserStats(groupId, winnerId, winnerUsername, loserId = null, loserUsername = null, isMegaBonk = false) {
    const storage = loadStorage();
    
    // Ensure group exists
    if (!storage[groupId]) {
        storage[groupId] = {};
    }
    
    // Ensure winner exists in storage
    if (!storage[groupId][winnerId]) {
        storage[groupId][winnerId] = {
            username: winnerUsername || 'Unknown',
            wins: 0,
            losses: 0,
            streak: 0
        };
    } else {
        // Update username if provided
        if (winnerUsername) {
            storage[groupId][winnerId].username = winnerUsername;
        }
    }
    
    // Update winner stats
    storage[groupId][winnerId].wins += isMegaBonk ? 2 : 1; // MEGA BONK gives double points
    storage[groupId][winnerId].streak += 1;
    
    // Update loser (if provided - for 1v1 compatibility)
    if (loserId && loserUsername) {
        if (!storage[groupId][loserId]) {
            storage[groupId][loserId] = {
                username: loserUsername || 'Unknown',
                wins: 0,
                losses: 0,
                streak: 0
            };
        } else {
            // Update username if provided
            if (loserUsername) {
                storage[groupId][loserId].username = loserUsername;
            }
        }
        
        storage[groupId][loserId].losses += 1;
        storage[groupId][loserId].streak = 0; // Reset streak on loss
    }
    
    saveStorage(storage);
    // console.log(`Updated stats for winner ${winnerUsername} in group ${groupId}:`, storage[groupId][winnerId]);
}

// Get leaderboard
function getLeaderboard(groupId) {
    const storage = loadStorage();
    
    if (!storage[groupId]) {
        return [];
    }
    
    return Object.entries(storage[groupId])
        .map(([userId, data]) => ({ userId, ...data }))
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 20);
}

// Parse user mention from text
function parseUserMention(text) {
    // Match @username pattern
    const match = text.match(/@(\w+)/);
    return match ? match[1] : null;
}

// Get random participants to eliminate (battle royale style)
function getEliminatedParticipants(participants, eliminationCount) {
    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, eliminationCount);
}

// Check for MEGA BONK (5% chance)
function isMegaBonk() {
    return Math.random() < 0.05;
}

// Format battle message
function formatBattleMessage(template, winner, eliminated) {
    return template
        .replace(/{winner}/g, winner)
        .replace(/{eliminated}/g, eliminated);
}

// Calculate elimination chance based on participants
function getEliminationCount(participantCount) {
    if (participantCount <= 2) return 1;
    if (participantCount <= 4) return 1;
    if (participantCount <= 8) return 2;
    return Math.floor(participantCount / 3);
}

// Clean timeout for battle
function cleanupBattle(groupId) {
    if (activeBattles.has(groupId)) {
        const battle = activeBattles.get(groupId);
        if (battle.timeout) {
            clearTimeout(battle.timeout);
        }
        activeBattles.delete(groupId);
    }
}

// Start battle royale
async function startBattleRoyale(ctx, participants) {
    const groupId = ctx.chat.id.toString();
    
    // Initialize battle state
    const battleState = {
        participants: [...participants],
        round: 1,
        inProgress: true
    };
    
    activeBattles.set(groupId, {
        participants: participants,
        battleState: battleState,
        inProgress: true
    });
    
    const participantNames = participants.map(p => `@${p.username}`).join(', ');
    await ctx.reply(`🔥⚔️ SUPERBONK BATTLE ROYALE STARTING! ⚔️🔥\n\n💀 FIGHTERS: ${participantNames}\n🎯 ${participants.length} BONKERS enter... only 1 survives!`);
    
    // Start first round after a brief delay
    setTimeout(() => playBattleRound(ctx, battleState), 2000);
}

// Play a battle royale round
async function playBattleRound(ctx, battleState) {
    const groupId = ctx.chat.id.toString();
    
    // Check if battle is still active
    if (!activeBattles.has(groupId)) {
        return;
    }
    
    const { participants } = battleState;
    
    // Check if only one participant left (winner!)
    if (participants.length <= 1) {
        if (participants.length === 1) {
            const winner = participants[0];
            const message = formatBattleMessage(
                BATTLE_ROYALE_MESSAGES[Math.floor(Math.random() * BATTLE_ROYALE_MESSAGES.length)],
                winner.username,
                ''
            );
            
            await ctx.reply(`🏆⚔️ BATTLE ROYALE COMPLETE! ⚔️🏆\n${message}\n\n🎉 Victory earned! +1 win! 🎉`);
            
            // Update winner stats
            updateUserStats(groupId, winner.id, winner.username, null, null, false);
        }
        
        // Cleanup
        cleanupBattle(groupId);
        return;
    }
    
    const megaBonk = isMegaBonk();
    const eliminationCount = getEliminationCount(participants.length);
    const toEliminate = getEliminatedParticipants(participants, eliminationCount);
    
    // Generate round message
    let roundMessage = `⚔️ ROUND ${battleState.round} ⚔️\n`;
    
    if (megaBonk) {
        roundMessage += MEGA_BONK_MESSAGES[Math.floor(Math.random() * MEGA_BONK_MESSAGES.length)] + '\n\n';
    }
    
    // Announce eliminations
    toEliminate.forEach(participant => {
        const elimMessage = formatBattleMessage(
            ELIMINATION_MESSAGES[Math.floor(Math.random() * ELIMINATION_MESSAGES.length)],
            '',
            participant.username
        );
        roundMessage += elimMessage + '\n';
    });
    
    // Remove eliminated participants
    toEliminate.forEach(eliminated => {
        const index = participants.findIndex(p => p.id === eliminated.id);
        if (index !== -1) {
            participants.splice(index, 1);
        }
    });
    
    roundMessage += `\n💀 ${toEliminate.length} eliminated! ${participants.length} BONKERS remain!`;
    
    await ctx.reply(roundMessage);
    
    battleState.round++;
    
    // Continue battle if more than 1 participant remains
    if (participants.length > 1) {
        setTimeout(() => playBattleRound(ctx, battleState), 3000);
    } else {
        // Battle will end on next call
        setTimeout(() => playBattleRound(ctx, battleState), 2000);
    }
}

// Command: /bonk - Join or start battle royale
bot.command('bonk', async (ctx) => {
    // Only work in groups
    if (ctx.chat.type === 'private') {
        return ctx.reply('SUPERBONK battle royales can only happen in group chats! 🤖');
    }
    
    const groupId = ctx.chat.id.toString();
    const userId = ctx.from.id.toString();
    const username = ctx.from.username || ctx.from.first_name || 'Unknown';
    
    // Check if there's an active battle
    if (activeBattles.has(groupId)) {
        const battle = activeBattles.get(groupId);
        
        // If battle is in progress, can't join
        if (battle.inProgress) {
            return ctx.reply('🔥 Battle royale already in progress! Wait for it to finish! ⚔️');
        }
        
        // Check if user already joined
        const alreadyJoined = battle.participants.some(p => p.id === userId);
        if (alreadyJoined) {
            return ctx.reply('💀 You\'re already in the battle queue! Wait for more fighters! ⏰');
        }
        
        // Add user to existing battle queue
        battle.participants.push({ id: userId, username });
        
        const participantCount = battle.participants.length;
        const participantNames = battle.participants.map(p => `@${p.username}`).join(', ');
        
        await ctx.reply(`⚔️ @${username} joins the BONK battle! ⚔️\n\n🎯 Current fighters (${participantCount}): ${participantNames}\n\n⏰ Battle starts in 10 seconds or when someone else joins!`);
        
        // Reset timeout
        if (battle.timeout) {
            clearTimeout(battle.timeout);
        }
        
        // Auto-start battle after 10 seconds or if 8+ people join
        const delay = participantCount >= 8 ? 1000 : 10000;
        battle.timeout = setTimeout(async () => {
            if (activeBattles.has(groupId) && !activeBattles.get(groupId).inProgress) {
                await startBattleRoyale(ctx, battle.participants);
            }
        }, delay);
        
        return;
    }
    
    // Start new battle queue
    const starter = { id: userId, username };
    
    // Set timeout for 30 seconds to auto-start
    const timeout = setTimeout(async () => {
        if (activeBattles.has(groupId)) {
            const battle = activeBattles.get(groupId);
            if (battle.participants.length === 1) {
                cleanupBattle(groupId);
                await ctx.reply(`😴 @${username} wanted to BONK but nobody joined! Battle cancelled! Use /bonk to start a new one! 💤`);
            } else {
                await startBattleRoyale(ctx, battle.participants);
            }
        }
    }, 30000);
    
    activeBattles.set(groupId, {
        participants: [starter],
        timeout: timeout,
        inProgress: false
    });
    
    await ctx.reply(`🔥⚔️ @${username} wants to start a BONK BATTLE ROYALE! ⚔️🔥\n\n💀 Type /bonk to join the chaos!\n⏰ Battle starts in 30 seconds or when more fighters join!\n\n🎯 More fighters = lower chance to win but MORE CHAOS! 🎯`);
});

// Command: /leaderboard
bot.command('leaderboard', async (ctx) => {
    if (ctx.chat.type === 'private') {
        return ctx.reply('Leaderboards are only available in group chats! 🤖');
    }
    
    const groupId = ctx.chat.id.toString();
    const leaderboard = getLeaderboard(groupId);
    
    if (leaderboard.length === 0) {
        return ctx.reply('🏆⚔️ SUPERBONK BATTLE ROYALE LEADERBOARD ⚔️🏆\n\nNo battles yet! Start a battle royale with /bonk! 💀');
    }
    
    let message = '🏆⚔️ SUPERBONK BATTLE ROYALE LEADERBOARD ⚔️🏆\n\n';
    
    leaderboard.forEach((user, index) => {
        const trophy = index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔨';
        const streak = user.streak > 0 ? ` 🔥${user.streak}` : '';
        message += `${trophy} @${user.username} – ${user.wins} Wins${streak}\n`;
    });
    
    await ctx.reply(message);
});

// Command: /bonkstats
bot.command('bonkstats', async (ctx) => {
    if (ctx.chat.type === 'private') {
        return ctx.reply('Stats are only available in group chats! 🤖');
    }
    
    const groupId = ctx.chat.id.toString();
    const commandText = ctx.message.text;
    const targetUsername = parseUserMention(commandText);
    
    let userId, username;
    
    if (targetUsername) {
        // Try to find user in storage by username
        const storage = loadStorage();
        if (storage[groupId]) {
            const userEntry = Object.entries(storage[groupId]).find(([id, data]) => 
                data.username.toLowerCase() === targetUsername.toLowerCase()
            );
            
            if (userEntry) {
                userId = userEntry[0];
                username = userEntry[1].username;
            } else {
                return ctx.reply(`📊 User @${targetUsername} not found in BONK records! They need to participate in a duel first! 🤷‍♂️`);
            }
        } else {
            return ctx.reply(`📊 User @${targetUsername} not found in BONK records! They need to participate in a duel first! 🤷‍♂️`);
        }
    } else {
        // Show stats for command sender
        userId = ctx.from.id.toString();
        username = ctx.from.username || ctx.from.first_name || 'Unknown';
    }
    
    const userData = getUserData(groupId, userId, username);
    const winRate = userData.wins + userData.losses > 0 ? 
        Math.round((userData.wins / (userData.wins + userData.losses)) * 100) : 0;
    
    const streakText = userData.streak > 0 ? ` 🔥 ${userData.streak} win streak!` : '';
    
    const message = `📊 BONK STATS for @${userData.username}\n\n` +
                   `🏆 Wins: ${userData.wins}\n` +
                   `💀 Losses: ${userData.losses}\n` +
                   `📈 Win Rate: ${winRate}%${streakText}`;
    
    await ctx.reply(message);
});

// Help command
bot.command('help', async (ctx) => {
    const helpMessage = `🔥⚔️ SUPERBONK BATTLE ROYALE BOT ⚔️🔥\n\n` +
                       `💀 /bonk - Start or join a battle royale!\n` +
                       `🏆 /leaderboard - View group leaderboard\n` +
                       `📊 /bonkstats [@username] - View battle stats\n` +
                       `❓ /help - Show this message\n\n` +
                       `🎯 HOW IT WORKS:\n` +
                       `• Type /bonk to start a battle royale\n` +
                       `• Others type /bonk to join (30 sec window)\n` +
                       `• More players = lower win chance but MORE CHAOS!\n` +
                       `• Random elimination each round until 1 survives\n` +
                       `• 5% chance for MEGA BONK chaos! 💥\n\n` +
                       `⚔️ Ready for the ultimate BONK battle? ⚔️`;
    
    await ctx.reply(helpMessage);
});

// Handle bot mentions for help
bot.on('text', async (ctx) => {
    const text = ctx.message.text.toLowerCase();
    const botUsername = ctx.botInfo.username.toLowerCase();
    
    if (text.includes(`@${botUsername}`) && ctx.chat.type !== 'private') {
        await ctx.reply('⚔️ Ready for BATTLE ROYALE? Use /help to see commands! 💀');
    }
});

// Error handling
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('🤖 Oops! Something went wrong with the BONK bot! Try again! 🔧');
});

// Start bot
async function startBot() {
    try {
        await bot.launch();
        console.log('🔥⚔️ SUPERBONK Battle Royale Bot is running! Ready for chaos! ⚔️🔥');
        
        // Graceful shutdown
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
        
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

startBot();