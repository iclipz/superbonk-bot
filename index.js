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
const cron = require('node-cron');
require('dotenv').config();

// Initialize bot
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('BOT_TOKEN environment variable is not set!');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Storage file paths
const STORAGE_FILE = path.join(__dirname, 'bonk_data.json');
const CLAN_STORAGE_FILE = path.join(__dirname, 'clan_data.json');

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

const JAIL_MESSAGES = [
    "🔨🚔 BONK! @{target} has been sent to horny jail! 🚔🔨\n\n🐶 No escape! Serve your time! 🔒",
    "🚔⚡ MEGA BONK! @{target} is sentenced to MAXIMUM SECURITY horny jail! ⚡🚔\n\n🚨 This is a CODE RED horny emergency! 🚨",
    "🔨💀 ULTRA BONK! @{target} has been banished to the shadow realm horny jail! 💀🔨\n\n👻 You brought this upon yourself! 👻",
    "🚔🔥 BONK POLICE! @{target} is under arrest for excessive horniness! 🔥🚔\n\n📜 Charges: Being too bonkable! 📜",
    "🔨⚖️ JUSTICE BONK! @{target} sentenced to life in horny jail! ⚖️🔨\n\n🏛️ The BONK court has spoken! 🏛️",
    "🚔💥 CRITICAL BONK! @{target} has been YEETED to horny jail! 💥🚔\n\n🌪️ That's what you get for being sus! 🌪️",
    "🔨🎯 PRECISION BONK! @{target} locked up in the highest security horny facility! 🎯🔨\n\n🔐 Key has been thrown away! 🔐",
    "🚔🌊 TSUNAMI BONK! @{target} has been washed away to horny jail island! 🌊🚔\n\n🏝️ Population: You! 🏝️"
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

// Load or create clan storage
function loadClanStorage() {
    try {
        if (fs.existsSync(CLAN_STORAGE_FILE)) {
            return JSON.parse(fs.readFileSync(CLAN_STORAGE_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading clan storage:', error);
    }
    return {
        clans: {},           // clanTag -> { name, groupId, createdAt, totalPoints, memberCount, wins, battles, dailyWins, lastActivity }
        groupClans: {},      // groupId -> clanTag
        globalStats: {
            totalClans: 0,
            totalBattles: 0,
            currentSeason: 1,
            seasonStartDate: new Date().toISOString(),
            dailyWinHistory: [], // Array of { date, winnerClan, totalActiveCans }
            lastDailyWinner: null,
            lastDailyWinDate: null
        }
    };
}

// Save clan storage
function saveClanStorage(data) {
    try {
        fs.writeFileSync(CLAN_STORAGE_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving clan storage:', error);
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

// Get clan for group
function getClanForGroup(groupId) {
    const clanData = loadClanStorage();
    return clanData.groupClans[groupId] || null;
}

// Update clan activity (call whenever bot is used in a group)
function updateClanActivity(groupId) {
    const clanTag = getClanForGroup(groupId);
    if (!clanTag) return; // Group doesn't have a clan
    
    const clanData = loadClanStorage();
    if (clanData.clans[clanTag]) {
        clanData.clans[clanTag].lastActivity = new Date().toISOString();
        saveClanStorage(clanData);
    }
}

// Update clan stats
function updateClanStats(groupId, pointsToAdd = 1) {
    const clanTag = getClanForGroup(groupId);
    if (!clanTag) return; // Group doesn't have a clan
    
    const clanData = loadClanStorage();
    if (clanData.clans[clanTag]) {
        clanData.clans[clanTag].totalPoints += pointsToAdd;
        clanData.clans[clanTag].wins += 1;
        clanData.clans[clanTag].battles += 1;
        clanData.clans[clanTag].lastActivity = new Date().toISOString(); // Update activity on battle win
        clanData.globalStats.totalBattles += 1;
        saveClanStorage(clanData);
    }
}

// Get active clans (used bot within last 24 hours)
function getActiveClans() {
    const clanData = loadClanStorage();
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const activeClans = [];
    
    for (const [clanTag, clan] of Object.entries(clanData.clans)) {
        const lastActivity = new Date(clan.lastActivity);
        if (lastActivity > twentyFourHoursAgo) {
            activeClans.push({ tag: clanTag, ...clan });
        }
    }
    
    return activeClans;
}

// Select daily clan winner
async function selectDailyWinner() {
    const clanData = loadClanStorage();
    const today = new Date().toDateString();
    
    // Check if we already selected a winner today
    if (clanData.globalStats.lastDailyWinDate === today) {
        console.log('Daily winner already selected for today');
        return null;
    }
    
    const activeClans = getActiveClans();
    
    if (activeClans.length === 0) {
        console.log('No active clans found for daily winner selection');
        return null;
    }
    
    // Random selection
    const randomIndex = Math.floor(Math.random() * activeClans.length);
    const winner = activeClans[randomIndex];
    
    // Update winner stats
    clanData.clans[winner.tag].dailyWins += 1;
    
    // Update global stats
    clanData.globalStats.lastDailyWinner = winner.tag;
    clanData.globalStats.lastDailyWinDate = today;
    
    // Add to history
    clanData.globalStats.dailyWinHistory.push({
        date: today,
        winnerClan: winner.tag,
        totalActiveClans: activeClans.length
    });
    
    // Keep only last 30 days of history
    if (clanData.globalStats.dailyWinHistory.length > 30) {
        clanData.globalStats.dailyWinHistory = clanData.globalStats.dailyWinHistory.slice(-30);
    }
    
    saveClanStorage(clanData);
    
    console.log(`Daily winner selected: [${winner.tag}] from ${activeClans.length} active clans`);
    
    // Send announcements to all groups with clans
    await announceDailyWinner(winner.tag, activeClans.length);
    
    return winner;
}

// Announce daily winner to all groups
async function announceDailyWinner(winnerTag, totalActiveClans) {
    const clanData = loadClanStorage();
    
    for (const [groupId, clanTag] of Object.entries(clanData.groupClans)) {
        try {
            const isWinner = clanTag === winnerTag;
            const message = isWinner 
                ? `🏆⚔️ DAILY CLAN VICTORY! ⚔️🏆\n\n🎉 Congratulations! [${winnerTag}] has been selected as today's DAILY WINNER!\n\n🎲 Selected from ${totalActiveClans} active clans worldwide!\n🔥 +1 Daily Win Point earned!\n\n⚔️ Use /global to see the updated clan leaderboard!`
                : `🎯 Daily Clan Winner Selected! 🎯\n\n👑 Today's winner: [${winnerTag}]\n🎲 Selected from ${totalActiveClans} active clans\n\n💪 Keep using the bot daily to stay active and increase your chances!\n⚔️ Use /global to see the clan leaderboard!`;
            
            await bot.telegram.sendMessage(groupId, message);
        } catch (error) {
            console.error(`Failed to send daily winner announcement to group ${groupId}:`, error);
        }
    }
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
    
    // Calculate points for win
    const pointsEarned = isMegaBonk ? 2 : 1; // MEGA BONK gives double points
    
    // Update winner stats
    storage[groupId][winnerId].wins += pointsEarned;
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
    
    // Update clan stats if group has a clan
    updateClanStats(groupId, pointsEarned);
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
    
    // Determine if this is a mega bonk round (applies to all actions in this round)
    const megaBonk = isMegaBonk();
    
    // Check if only one participant left (winner!)
    if (participants.length <= 1) {
        if (participants.length === 1) {
            const winner = participants[0];
            const message = formatBattleMessage(
                BATTLE_ROYALE_MESSAGES[Math.floor(Math.random() * BATTLE_ROYALE_MESSAGES.length)],
                winner.username,
                ''
            );
            
            // Check if group has a clan for clan points message
            const clanTag = getClanForGroup(groupId);
            let victoryMessage = `🏆⚔️ BATTLE ROYALE COMPLETE! ⚔️🏆\n${message}\n\n🎉 Victory earned! +${megaBonk ? 2 : 1} ${megaBonk ? 'points' : 'point'}! 🎉`;
            
            if (clanTag) {
                victoryMessage += `\n⚔️ +${megaBonk ? 2 : 1} point${megaBonk ? 's' : ''} for clan [${clanTag}]! 🌍`;
            }
            
            await ctx.reply(victoryMessage);
            
            // Update winner stats - now correctly passing the megaBonk status
            updateUserStats(groupId, winner.id, winner.username, null, null, megaBonk);
        }
        
        // Cleanup
        cleanupBattle(groupId);
        return;
    }
    
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

// Command: /createclan - Create a clan for this group
bot.command('createclan', async (ctx) => {
    // Only work in groups
    if (ctx.chat.type === 'private') {
        return ctx.reply('Clans can only be created in group chats! 🤖');
    }
    
    const groupId = ctx.chat.id.toString();
    updateClanActivity(groupId); // Track activity
    const args = ctx.message.text.split(' ').slice(1);
    
    if (args.length === 0) {
        return ctx.reply('🏷️ Please specify a 4-letter clan tag!\n\nUsage: /createclan BONK\n\n⚔️ Clan tags must be exactly 4 letters and unique!');
    }
    
    const clanTag = args[0].toUpperCase();
    
    // Validate clan tag
    if (clanTag.length !== 4 || !/^[A-Z]{4}$/.test(clanTag)) {
        return ctx.reply('❌ Clan tag must be exactly 4 letters (A-Z only)!\n\nExample: /createclan BONK');
    }
    
    const clanData = loadClanStorage();
    
    // Check if group already has a clan
    if (clanData.groupClans[groupId]) {
        const existingTag = clanData.groupClans[groupId];
        return ctx.reply(`⚔️ This group already has clan tag: [${existingTag}]\n\nUse /rank to see your clan info!`);
    }
    
    // Check if clan tag is taken
    if (clanData.clans[clanTag]) {
        return ctx.reply(`❌ Clan tag [${clanTag}] is already taken!\n\nTry a different 4-letter combination.`);
    }
    
    // Create the clan
    clanData.clans[clanTag] = {
        name: clanTag,
        groupId: groupId,
        createdAt: new Date().toISOString(),
        totalPoints: 0,
        memberCount: 0,
        wins: 0,
        battles: 0,
        dailyWins: 0,
        lastActivity: new Date().toISOString()
    };
    
    clanData.groupClans[groupId] = clanTag;
    clanData.globalStats.totalClans += 1;
    
    saveClanStorage(clanData);
    
    await ctx.reply(`🔥⚔️ CLAN [${clanTag}] CREATED! ⚔️🔥\n\n🏷️ Your group is now part of the global SUPERBONK clan wars!\n📊 Use /rank to see your progress\n🌍 Use /global to see all clans\n\n💀 Every battle royale victory now earns points for your clan! Let the wars begin!`);
});

// Command: /rank - Show clan statistics
bot.command('rank', async (ctx) => {
    if (ctx.chat.type === 'private') {
        return ctx.reply('Clan stats are only available in group chats! 🤖');
    }
    
    const groupId = ctx.chat.id.toString();
    updateClanActivity(groupId); // Track activity
    const clanTag = getClanForGroup(groupId);
    
    if (!clanTag) {
        return ctx.reply('❌ This group doesn\'t have a clan yet!\n\nCreate one with: /createclan ABCD\n\n⚔️ Join the global clan wars!');
    }
    
    const clanData = loadClanStorage();
    const clan = clanData.clans[clanTag];
    
    if (!clan) {
        return ctx.reply('❌ Clan data not found! Please contact support.');
    }
    
    // Calculate clan ranking
    const allClans = Object.entries(clanData.clans)
        .map(([tag, data]) => ({ tag, ...data }))
        .sort((a, b) => b.dailyWins - a.dailyWins);
    
    const rank = allClans.findIndex(c => c.tag === clanTag) + 1;
    const lastActivity = new Date(clan.lastActivity).toLocaleDateString();
    
    const message = `⚔️ CLAN [${clanTag}] STATS ⚔️\n\n` +
                   `🏆 Global Rank: #${rank} of ${allClans.length}\n` +
                   `🎯 Daily Wins: ${clan.dailyWins}\n` +
                   `⚔️ Battle Royale Wins: ${clan.wins}\n` +
                   `📅 Created: ${new Date(clan.createdAt).toLocaleDateString()}\n` +
                   `🕒 Last Active: ${lastActivity}\n\n` +
                   `🎲 Daily winners are selected randomly from active clans!\n` +
                   `🌍 Compete against ${allClans.length - 1} other clans worldwide!`;
    
    await ctx.reply(message);
});

// Command: /global - Show global clan rankings
bot.command('global', async (ctx) => {
    const clanData = loadClanStorage();
    
    if (Object.keys(clanData.clans).length === 0) {
        return ctx.reply('🌍 No clans exist yet!\n\nBe the first to create one: /createclan ABCD\n\n⚔️ Start the global clan wars!');
    }
    
    const allClans = Object.entries(clanData.clans)
        .map(([tag, data]) => ({ tag, ...data }))
        .sort((a, b) => b.dailyWins - a.dailyWins)
        .slice(0, 20);
    
    let message = '🌍⚔️ GLOBAL CLAN LEADERBOARD ⚔️🌍\n🎯 Ranked by Daily Wins (Random Daily Selection)\n\n';
    
    allClans.forEach((clan, index) => {
        const trophy = index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : '⚔️';
        const lastActivity = new Date(clan.lastActivity).toLocaleDateString();
        message += `${trophy} [${clan.tag}] – ${clan.dailyWins} Daily Wins (Last active: ${lastActivity})\n`;
    });
    
    message += `\n🔥 ${allClans.length} clans competing worldwide!\n💀 Create your clan: /createclan ABCD`;
    
    await ctx.reply(message);
});

// Command: /clansearch - Search for clans by tag
bot.command('clansearch', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    
    if (args.length === 0) {
        return ctx.reply('🔍 Please specify a clan tag to search for!\n\nUsage: /clansearch BONK');
    }
    
    const searchTag = args[0].toUpperCase();
    const clanData = loadClanStorage();
    
    if (clanData.clans[searchTag]) {
        const clan = clanData.clans[searchTag];
        
        // Calculate ranking
        const allClans = Object.entries(clanData.clans)
            .map(([tag, data]) => ({ tag, ...data }))
            .sort((a, b) => b.dailyWins - a.dailyWins);
        
        const rank = allClans.findIndex(c => c.tag === searchTag) + 1;
        const lastActivity = new Date(clan.lastActivity).toLocaleDateString();
        
        const message = `🔍 CLAN FOUND: [${searchTag}] 🔍\n\n` +
                       `🏆 Global Rank: #${rank} of ${allClans.length}\n` +
                       `🎯 Daily Wins: ${clan.dailyWins}\n` +
                       `⚔️ Battle Royale Wins: ${clan.wins}\n` +
                       `📅 Created: ${new Date(clan.createdAt).toLocaleDateString()}\n` +
                       `🕒 Last Active: ${lastActivity}\n\n` +
                       `🎲 Daily winners selected randomly from active clans!`;
        
        await ctx.reply(message);
    } else {
        await ctx.reply(`❌ Clan tag [${searchTag}] not found!\n\n🔍 Search is case-insensitive\n💭 Maybe they haven't created a clan yet?\n⚔️ View all clans: /global`);
    }
});

// Command: /jail - Send someone to horny jail
bot.command('jail', async (ctx) => {
    // Only work in groups
    if (ctx.chat.type === 'private') {
        return ctx.reply('You can only send people to horny jail in group chats! 🚔');
    }
    
    const groupId = ctx.chat.id.toString();
    updateClanActivity(groupId); // Track activity
    const senderId = ctx.from.id.toString();
    const senderUsername = ctx.from.username || ctx.from.first_name || 'Unknown';
    
    let targetUsername = null;
    let targetUserId = null;
    
    // Check if replying to a message
    if (ctx.message.reply_to_message) {
        const repliedUser = ctx.message.reply_to_message.from;
        targetUserId = repliedUser.id.toString();
        targetUsername = repliedUser.username || repliedUser.first_name || 'Unknown';
    } else {
        // Parse mentioned user from command text
        const commandText = ctx.message.text;
        const mentionMatch = commandText.match(/@(\w+)/);
        
        if (mentionMatch) {
            targetUsername = mentionMatch[1];
        }
    }
    
    if (!targetUsername) {
        return ctx.reply('🚔 Who should I send to horny jail? 🚔\n\nUsage:\n• /jail @username\n• Reply to a message with /jail\n\n🔨 Time to dispense some justice! 🔨');
    }
    
    // Prevent self-jailing
    if (targetUsername === senderUsername || targetUserId === senderId) {
        return ctx.reply('🤔 You can\'t send yourself to horny jail!\n\n🔨 That\'s not how this works! Find someone else to BONK! 🔨');
    }
    
    // Prevent jailing the bot
    if (targetUsername.toLowerCase().includes('superbonk') || targetUsername.toLowerCase().includes('bot')) {
        return ctx.reply('🤖 Nice try, but you can\'t jail the BONK POLICE! 🚔\n\n⚡ I AM THE LAW! ⚡');
    }
    
    // Select random jail message
    const jailMessage = JAIL_MESSAGES[Math.floor(Math.random() * JAIL_MESSAGES.length)];
    const formattedMessage = jailMessage.replace(/{target}/g, targetUsername);
    
    // Add sender credit
    const fullMessage = formattedMessage + `\n\n👮‍♂️ Arrest made by: @${senderUsername}`;
    
    await ctx.reply(fullMessage);
});

// Command: /bonk - Join or start battle royale
bot.command('bonk', async (ctx) => {
    // Only work in groups
    if (ctx.chat.type === 'private') {
        return ctx.reply('SUPERBONK battle royales can only happen in group chats! 🤖');
    }
    
    const groupId = ctx.chat.id.toString();
    updateClanActivity(groupId); // Track activity
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
    updateClanActivity(groupId); // Track activity
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

// Command: /dailywinner - Show today's daily winner
bot.command('dailywinner', async (ctx) => {
    const clanData = loadClanStorage();
    const today = new Date().toDateString();
    
    if (clanData.globalStats.lastDailyWinDate === today) {
        const winner = clanData.globalStats.lastDailyWinner;
        const winnerClan = clanData.clans[winner];
        const totalActiveClans = getActiveClans().length;
        
        await ctx.reply(`🏆 TODAY'S DAILY CLAN WINNER 🏆\n\n👑 Winner: [${winner}]\n🎲 Selected from ${totalActiveClans} active clans\n🕐 Selected at 12:00 PM UTC\n\n⚔️ Use /global to see updated leaderboard!\n💪 Use the bot daily to keep your clan active!`);
    } else {
        const activeClans = getActiveClans();
        await ctx.reply(`⏰ NO WINNER SELECTED YET TODAY ⏰\n\n🎯 Current active clans: ${activeClans.length}\n🕐 Next selection: 12:00 PM UTC\n\n💪 Use the bot to keep your clan active and eligible!\n📊 Active = used bot within last 24 hours`);
    }
});

// Command: /dailyhistory - Show recent daily winner history
bot.command('dailyhistory', async (ctx) => {
    const clanData = loadClanStorage();
    const history = clanData.globalStats.dailyWinHistory || [];
    
    if (history.length === 0) {
        return ctx.reply('📚 NO DAILY HISTORY YET 📚\n\nDaily winner selection starts once clans are created!\n\n⚔️ Create a clan: /createclan ABCD\n🕐 Winners selected daily at 12:00 PM UTC');
    }
    
    let message = '📚⚔️ RECENT DAILY WINNERS ⚔️📚\n\n';
    
    // Show last 10 days
    const recentHistory = history.slice(-10).reverse();
    
    recentHistory.forEach((entry, index) => {
        const icon = index === 0 ? '🏆' : '📅';
        message += `${icon} ${entry.date}: [${entry.winnerClan}] (${entry.totalActiveClans} active clans)\n`;
    });
    
    message += `\n🎯 Showing last ${recentHistory.length} days\n🎲 Winners selected randomly from active clans\n⚔️ Use /global for current leaderboard`;
    
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
                       `💀 BATTLE COMMANDS:\n` +
                       `• /bonk - Start or join a battle royale!\n` +
                       `• /leaderboard - View group leaderboard\n` +
                       `• /bonkstats [@username] - View battle stats\n\n` +
                       `🚔 FUN COMMANDS:\n` +
                       `• /jail @username - Send someone to horny jail!\n\n` +
                       `🌍 CLAN WAR COMMANDS:\n` +
                       `• /createclan ABCD - Create a 4-letter clan tag\n` +
                       `• /rank - View your clan's global ranking\n` +
                       `• /global - Top clans worldwide (by daily wins)\n` +
                       `• /clansearch ABCD - Find info about any clan\n\n` +
                       `🎲 DAILY WINNER COMMANDS:\n` +
                       `• /dailywinner - See today's randomly selected clan winner\n` +
                       `• /dailyhistory - View recent daily winner history\n\n` +
                       `🎯 HOW IT WORKS:\n` +
                       `• Type /bonk to start a battle royale\n` +
                       `• Others type /bonk to join (30 sec window)\n` +
                       `• More players = lower win chance but MORE CHAOS!\n` +
                       `• Random elimination each round until 1 survives\n` +
                       `• 5% chance for MEGA BONK chaos! 💥\n\n` +
                       `🏆 DAILY CLAN SYSTEM:\n` +
                       `• Every day at 12 PM UTC, one random active clan wins!\n` +
                       `• Active = used bot within last 24 hours\n` +
                       `• More active clans = lower chance but more competition!\n` +
                       `• Leaderboard ranked by daily wins, not battle wins!\n\n` +
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
        
        // Schedule daily clan winner selection (runs at 12:00 PM UTC daily)
        cron.schedule('0 12 * * *', async () => {
            console.log('Running daily clan winner selection...');
            try {
                await selectDailyWinner();
            } catch (error) {
                console.error('Error during daily winner selection:', error);
            }
        }, {
            timezone: "UTC"
        });
        
        console.log('📅 Daily clan winner selection scheduled for 12:00 PM UTC');
        
        // Graceful shutdown
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
        
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

startBot();