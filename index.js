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
const { Pool } = require('pg');
require('dotenv').config();

// Initialize bot
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('BOT_TOKEN environment variable is not set!');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Database configuration
console.log('🔍 DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.on('connect', () => {
    console.log('🗄️ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('PostgreSQL connection error:', err);
});

// Legacy storage file paths (for migration reference)
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

// Initialize database schema
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        // Create users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                group_id VARCHAR(255) NOT NULL,
                user_id VARCHAR(255) NOT NULL,
                username VARCHAR(255) NOT NULL,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                streak INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(group_id, user_id)
            )
        `);

        // Create clans table
        await client.query(`
            CREATE TABLE IF NOT EXISTS clans (
                id SERIAL PRIMARY KEY,
                clan_tag VARCHAR(4) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                group_id VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_points INTEGER DEFAULT 0,
                member_count INTEGER DEFAULT 0,
                wins INTEGER DEFAULT 0,
                battles INTEGER DEFAULT 0,
                daily_wins INTEGER DEFAULT 0,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create group_clans mapping table
        await client.query(`
            CREATE TABLE IF NOT EXISTS group_clans (
                id SERIAL PRIMARY KEY,
                group_id VARCHAR(255) UNIQUE NOT NULL,
                clan_tag VARCHAR(4) NOT NULL,
                FOREIGN KEY (clan_tag) REFERENCES clans(clan_tag) ON DELETE CASCADE
            )
        `);

        // Create global_stats table
        await client.query(`
            CREATE TABLE IF NOT EXISTS global_stats (
                id SERIAL PRIMARY KEY,
                total_clans INTEGER DEFAULT 0,
                total_battles INTEGER DEFAULT 0,
                current_season INTEGER DEFAULT 1,
                season_start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_daily_winner VARCHAR(4),
                last_daily_win_date DATE
            )
        `);

        // Create daily_win_history table
        await client.query(`
            CREATE TABLE IF NOT EXISTS daily_win_history (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                winner_clan VARCHAR(4) NOT NULL,
                total_active_clans INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Initialize global stats if empty
        const globalStats = await client.query('SELECT COUNT(*) FROM global_stats');
        if (parseInt(globalStats.rows[0].count) === 0) {
            await client.query(`
                INSERT INTO global_stats (total_clans, total_battles, current_season, season_start_date)
                VALUES (0, 0, 1, CURRENT_TIMESTAMP)
            `);
        }

        console.log('✅ Database schema initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing database:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Load or create storage (LEGACY - will be replaced)
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
async function getUserData(groupId, userId, username) {
    const client = await pool.connect();
    try {
        // Try to get existing user
        let result = await client.query(
            'SELECT username, wins, losses, streak FROM users WHERE group_id = $1 AND user_id = $2',
            [groupId, userId]
        );

        if (result.rows.length === 0) {
            // Create new user
            await client.query(
                `INSERT INTO users (group_id, user_id, username, wins, losses, streak) 
                 VALUES ($1, $2, $3, 0, 0, 0)`,
                [groupId, userId, username || 'Unknown']
            );
            
            return {
                username: username || 'Unknown',
                wins: 0,
                losses: 0,
                streak: 0
            };
        } else {
            // Update username if provided
            if (username && username !== result.rows[0].username) {
                await client.query(
                    'UPDATE users SET username = $1, updated_at = CURRENT_TIMESTAMP WHERE group_id = $2 AND user_id = $3',
                    [username, groupId, userId]
                );
                result.rows[0].username = username;
            }
            
            return result.rows[0];
        }
    } catch (error) {
        console.error('Error in getUserData:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Get clan for group
async function getClanForGroup(groupId) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT clan_tag FROM group_clans WHERE group_id = $1',
            [groupId]
        );
        
        return result.rows.length > 0 ? result.rows[0].clan_tag : null;
    } catch (error) {
        console.error('Error in getClanForGroup:', error);
        return null;
    } finally {
        client.release();
    }
}

// Update clan activity (call whenever bot is used in a group)
async function updateClanActivity(groupId) {
    const clanTag = await getClanForGroup(groupId);
    if (!clanTag) return; // Group doesn't have a clan
    
    const client = await pool.connect();
    try {
        await client.query(
            'UPDATE clans SET last_activity = CURRENT_TIMESTAMP WHERE clan_tag = $1',
            [clanTag]
        );
    } catch (error) {
        console.error('Error updating clan activity:', error);
    } finally {
        client.release();
    }
}

// Update clan stats
async function updateClanStats(groupId, pointsToAdd = 1) {
    const clanTag = await getClanForGroup(groupId);
    if (!clanTag) return; // Group doesn't have a clan
    
    const client = await pool.connect();
    try {
        // Update clan stats
        await client.query(
            `UPDATE clans SET 
             total_points = total_points + $1, 
             wins = wins + 1, 
             battles = battles + 1, 
             last_activity = CURRENT_TIMESTAMP 
             WHERE clan_tag = $2`,
            [pointsToAdd, clanTag]
        );
        
        // Update global stats
        await client.query(
            'UPDATE global_stats SET total_battles = total_battles + 1'
        );
    } catch (error) {
        console.error('Error updating clan stats:', error);
    } finally {
        client.release();
    }
}

// Get active clans (used bot within last 24 hours)
async function getActiveClans() {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT clan_tag as tag, name, group_id, created_at, total_points, 
                    member_count, wins, battles, daily_wins, last_activity 
             FROM clans 
             WHERE last_activity > NOW() - INTERVAL '24 hours'`
        );
        
        return result.rows;
    } catch (error) {
        console.error('Error getting active clans:', error);
        return [];
    } finally {
        client.release();
    }
}

// Select daily clan winner
async function selectDailyWinner() {
    const client = await pool.connect();
    try {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        
        // Check if we already selected a winner today
        const existingWinner = await client.query(
            'SELECT last_daily_winner FROM global_stats WHERE last_daily_win_date = $1',
            [today]
        );
        
        if (existingWinner.rows.length > 0) {
            console.log('Daily winner already selected for today');
            return null;
        }
        
        const activeClans = await getActiveClans();
        
        if (activeClans.length === 0) {
            console.log('No active clans found for daily winner selection');
            return null;
        }
        
        // Random selection
        const randomIndex = Math.floor(Math.random() * activeClans.length);
        const winner = activeClans[randomIndex];
        
        // Update winner stats
        await client.query(
            'UPDATE clans SET daily_wins = daily_wins + 1 WHERE clan_tag = $1',
            [winner.tag]
        );
        
        // Update global stats
        await client.query(
            'UPDATE global_stats SET last_daily_winner = $1, last_daily_win_date = $2',
            [winner.tag, today]
        );
        
        // Add to history
        await client.query(
            'INSERT INTO daily_win_history (date, winner_clan, total_active_clans) VALUES ($1, $2, $3)',
            [today, winner.tag, activeClans.length]
        );
        
        // Keep only last 30 days of history
        await client.query(
            'DELETE FROM daily_win_history WHERE date < $1',
            [new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]]
        );
        
        console.log(`Daily winner selected: [${winner.tag}] from ${activeClans.length} active clans`);
        
        // Send announcements to all groups with clans
        await announceDailyWinner(winner.tag, activeClans.length);
        
        return winner;
    } catch (error) {
        console.error('Error selecting daily winner:', error);
        return null;
    } finally {
        client.release();
    }
}

// Announce daily winner to all groups
async function announceDailyWinner(winnerTag, totalActiveClans) {
    const client = await pool.connect();
    try {
        // Get all group-clan mappings
        const result = await client.query('SELECT group_id, clan_tag FROM group_clans');
        
        for (const row of result.rows) {
            try {
                const isWinner = row.clan_tag === winnerTag;
                const message = isWinner 
                    ? `🏆⚔️ DAILY CLAN VICTORY! ⚔️🏆\n\n🎉 Congratulations! [${winnerTag}] has been selected as today's DAILY WINNER!\n\n🎲 Selected from ${totalActiveClans} active clans worldwide!\n🔥 +1 Daily Win Point earned!\n\n⚔️ Use /global to see the updated clan leaderboard!`
                    : `🎯 Daily Clan Winner Selected! 🎯\n\n👑 Today's winner: [${winnerTag}]\n🎲 Selected from ${totalActiveClans} active clans\n\n💪 Keep using the bot daily to stay active and increase your chances!\n⚔️ Use /global to see the clan leaderboard!`;
                
                await bot.telegram.sendMessage(row.group_id, message);
            } catch (error) {
                console.error(`Failed to send daily winner announcement to group ${row.group_id}:`, error);
            }
        }
    } catch (error) {
        console.error('Error announcing daily winner:', error);
    } finally {
        client.release();
    }
}

// Update user stats
async function updateUserStats(groupId, winnerId, winnerUsername, loserId = null, loserUsername = null, isMegaBonk = false) {
    const client = await pool.connect();
    try {
        // Calculate points for win
        const pointsEarned = isMegaBonk ? 2 : 1; // MEGA BONK gives double points
        
        // Ensure winner exists and update stats
        await client.query(
            `INSERT INTO users (group_id, user_id, username, wins, losses, streak) 
             VALUES ($1, $2, $3, $4, 0, 1)
             ON CONFLICT (group_id, user_id) 
             DO UPDATE SET 
                username = $3,
                wins = users.wins + $4,
                streak = users.streak + 1,
                updated_at = CURRENT_TIMESTAMP`,
            [groupId, winnerId, winnerUsername || 'Unknown', pointsEarned]
        );
        
        // Update loser (if provided - for 1v1 compatibility)
        if (loserId && loserUsername) {
            await client.query(
                `INSERT INTO users (group_id, user_id, username, wins, losses, streak) 
                 VALUES ($1, $2, $3, 0, 1, 0)
                 ON CONFLICT (group_id, user_id) 
                 DO UPDATE SET 
                    username = $3,
                    losses = users.losses + 1,
                    streak = 0,
                    updated_at = CURRENT_TIMESTAMP`,
                [groupId, loserId, loserUsername || 'Unknown']
            );
        }
        
        // Update clan stats if group has a clan
        await updateClanStats(groupId, pointsEarned);
    } catch (error) {
        console.error('Error updating user stats:', error);
    } finally {
        client.release();
    }
}

// Get leaderboard
async function getLeaderboard(groupId) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT user_id as userId, username, wins, losses, streak 
             FROM users 
             WHERE group_id = $1 
             ORDER BY wins DESC 
             LIMIT 20`,
            [groupId]
        );
        
        return result.rows;
    } catch (error) {
        console.error('Error getting leaderboard:', error);
        return [];
    } finally {
        client.release();
    }
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
            await updateUserStats(groupId, winner.id, winner.username, null, null, megaBonk);
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
    await updateClanActivity(groupId); // Track activity
    const args = ctx.message.text.split(' ').slice(1);
    
    if (args.length === 0) {
        return ctx.reply('🏷️ Please specify a 4-letter clan tag!\n\nUsage: /createclan BONK\n\n⚔️ Clan tags must be exactly 4 letters and unique!');
    }
    
    const clanTag = args[0].toUpperCase();
    
    // Validate clan tag
    if (clanTag.length !== 4 || !/^[A-Z]{4}$/.test(clanTag)) {
        return ctx.reply('❌ Clan tag must be exactly 4 letters (A-Z only)!\n\nExample: /createclan BONK');
    }
    
    const client = await pool.connect();
    try {
        // Check if group already has a clan
        const existingClan = await client.query(
            'SELECT clan_tag FROM group_clans WHERE group_id = $1',
            [groupId]
        );
        
        if (existingClan.rows.length > 0) {
            const existingTag = existingClan.rows[0].clan_tag;
            return ctx.reply(`⚔️ This group already has clan tag: [${existingTag}]\n\nUse /rank to see your clan info!`);
        }
        
        // Check if clan tag is taken
        const takenClan = await client.query(
            'SELECT clan_tag FROM clans WHERE clan_tag = $1',
            [clanTag]
        );
        
        if (takenClan.rows.length > 0) {
            return ctx.reply(`❌ Clan tag [${clanTag}] is already taken!\n\nTry a different 4-letter combination.`);
        }
        
        // Create the clan
        await client.query(
            `INSERT INTO clans (clan_tag, name, group_id, total_points, member_count, wins, battles, daily_wins, last_activity) 
             VALUES ($1, $2, $3, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP)`,
            [clanTag, clanTag, groupId]
        );
        
        // Create group-clan mapping
        await client.query(
            'INSERT INTO group_clans (group_id, clan_tag) VALUES ($1, $2)',
            [groupId, clanTag]
        );
        
        // Update global stats
        await client.query(
            'UPDATE global_stats SET total_clans = total_clans + 1'
        );
        
        await ctx.reply(`🔥⚔️ CLAN [${clanTag}] CREATED! ⚔️🔥\n\n🏷️ Your group is now part of the global SUPERBONK clan wars!\n📊 Use /rank to see your progress\n🌍 Use /global to see all clans\n\n💀 Every battle royale victory now earns points for your clan! Let the wars begin!`);
    } catch (error) {
        console.error('Error creating clan:', error);
        await ctx.reply('❌ Error creating clan. Please try again later.');
    } finally {
        client.release();
    }
});

// Command: /rank - Show clan statistics
bot.command('rank', async (ctx) => {
    if (ctx.chat.type === 'private') {
        return ctx.reply('Clan stats are only available in group chats! 🤖');
    }
    
    const groupId = ctx.chat.id.toString();
    await updateClanActivity(groupId); // Track activity
    const clanTag = await getClanForGroup(groupId);
    
    if (!clanTag) {
        return ctx.reply('❌ This group doesn\'t have a clan yet!\n\nCreate one with: /createclan ABCD\n\n⚔️ Join the global clan wars!');
    }
    
    const client = await pool.connect();
    try {
        const clanResult = await client.query(
            'SELECT * FROM clans WHERE clan_tag = $1',
            [clanTag]
        );
        
        if (clanResult.rows.length === 0) {
            return ctx.reply('❌ Clan data not found! Please contact support.');
        }
        
        const clan = clanResult.rows[0];
        
        // Calculate clan ranking
        const allClansResult = await client.query(
            'SELECT clan_tag, daily_wins FROM clans ORDER BY daily_wins DESC'
        );
        
        const rank = allClansResult.rows.findIndex(c => c.clan_tag === clanTag) + 1;
        const lastActivity = new Date(clan.last_activity).toLocaleDateString();
        
        const message = `⚔️ CLAN [${clanTag}] STATS ⚔️\n\n` +
                       `🏆 Global Rank: #${rank} of ${allClansResult.rows.length}\n` +
                       `🎯 Daily Wins: ${clan.daily_wins}\n` +
                       `⚔️ Battle Royale Wins: ${clan.wins}\n` +
                       `📅 Created: ${new Date(clan.created_at).toLocaleDateString()}\n` +
                       `🕒 Last Active: ${lastActivity}\n\n` +
                       `🎲 Daily winners are selected randomly from active clans!\n` +
                       `🌍 Compete against ${allClansResult.rows.length - 1} other clans worldwide!`;
        
        await ctx.reply(message);
    } catch (error) {
        console.error('Error getting clan rank:', error);
        await ctx.reply('❌ Error getting clan info. Please try again later.');
    } finally {
        client.release();
    }
});

// Command: /global - Show global clan rankings
bot.command('global', async (ctx) => {
    const client = await pool.connect();
    try {
        const allClansResult = await client.query(
            'SELECT clan_tag as tag, daily_wins, last_activity FROM clans ORDER BY daily_wins DESC LIMIT 20'
        );
        
        if (allClansResult.rows.length === 0) {
            return ctx.reply('🌍 No clans exist yet!\n\nBe the first to create one: /createclan ABCD\n\n⚔️ Start the global clan wars!');
        }
        
        let message = '🌍⚔️ GLOBAL CLAN LEADERBOARD ⚔️🌍\n🎯 Ranked by Daily Wins (Random Daily Selection)\n\n';
        
        allClansResult.rows.forEach((clan, index) => {
            const trophy = index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : '⚔️';
            const lastActivity = new Date(clan.last_activity).toLocaleDateString();
            message += `${trophy} [${clan.tag}] – ${clan.daily_wins} Daily Wins (Last active: ${lastActivity})\n`;
        });
        
        message += `\n🔥 ${allClansResult.rows.length} clans competing worldwide!\n💀 Create your clan: /createclan ABCD`;
        
        await ctx.reply(message);
    } catch (error) {
        console.error('Error getting global leaderboard:', error);
        await ctx.reply('❌ Error getting clan leaderboard. Please try again later.');
    } finally {
        client.release();
    }
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
    await updateClanActivity(groupId); // Track activity
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
    await updateClanActivity(groupId); // Track activity
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
    await updateClanActivity(groupId); // Track activity
    const leaderboard = await getLeaderboard(groupId);
    
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
    const client = await pool.connect();
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const globalStatsResult = await client.query(
            'SELECT last_daily_winner, last_daily_win_date FROM global_stats WHERE last_daily_win_date = $1',
            [today]
        );
        
        if (globalStatsResult.rows.length > 0) {
            const winner = globalStatsResult.rows[0].last_daily_winner;
            const totalActiveClans = (await getActiveClans()).length;
            
            await ctx.reply(`🏆 TODAY'S DAILY CLAN WINNER 🏆\n\n👑 Winner: [${winner}]\n🎲 Selected from ${totalActiveClans} active clans\n🕐 Selected at 12:00 PM UTC\n\n⚔️ Use /global to see updated leaderboard!\n💪 Use the bot daily to keep your clan active!`);
        } else {
            const activeClans = await getActiveClans();
            await ctx.reply(`⏰ NO WINNER SELECTED YET TODAY ⏰\n\n🎯 Current active clans: ${activeClans.length}\n🕐 Next selection: 12:00 PM UTC\n\n💪 Use the bot to keep your clan active and eligible!\n📊 Active = used bot within last 24 hours`);
        }
    } catch (error) {
        console.error('Error getting daily winner:', error);
        await ctx.reply('❌ Error getting daily winner info. Please try again later.');
    } finally {
        client.release();
    }
});

// Command: /dailyhistory - Show recent daily winner history
bot.command('dailyhistory', async (ctx) => {
    const client = await pool.connect();
    try {
        const historyResult = await client.query(
            'SELECT date, winner_clan, total_active_clans FROM daily_win_history ORDER BY date DESC LIMIT 10'
        );
        
        if (historyResult.rows.length === 0) {
            return ctx.reply('📚 NO DAILY HISTORY YET 📚\n\nDaily winner selection starts once clans are created!\n\n⚔️ Create a clan: /createclan ABCD\n🕐 Winners selected daily at 12:00 PM UTC');
        }
        
        let message = '📚⚔️ RECENT DAILY WINNERS ⚔️📚\n\n';
        
        historyResult.rows.forEach((entry, index) => {
            const icon = index === 0 ? '🏆' : '📅';
            const formattedDate = new Date(entry.date).toDateString();
            message += `${icon} ${formattedDate}: [${entry.winner_clan}] (${entry.total_active_clans} active clans)\n`;
        });
        
        message += `\n🎯 Showing last ${historyResult.rows.length} days\n🎲 Winners selected randomly from active clans\n⚔️ Use /global for current leaderboard`;
        
        await ctx.reply(message);
    } catch (error) {
        console.error('Error getting daily history:', error);
        await ctx.reply('❌ Error getting daily history. Please try again later.');
    } finally {
        client.release();
    }
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
        // Try to find user in database by username
        const client = await pool.connect();
        try {
            const userResult = await client.query(
                'SELECT user_id, username FROM users WHERE group_id = $1 AND LOWER(username) = LOWER($2)',
                [groupId, targetUsername]
            );
            
            if (userResult.rows.length > 0) {
                userId = userResult.rows[0].user_id;
                username = userResult.rows[0].username;
            } else {
                return ctx.reply(`📊 User @${targetUsername} not found in BONK records! They need to participate in a duel first! 🤷‍♂️`);
            }
        } catch (error) {
            console.error('Error finding user:', error);
            return ctx.reply(`📊 User @${targetUsername} not found in BONK records! They need to participate in a duel first! 🤷‍♂️`);
        } finally {
            client.release();
        }
    } else {
        // Show stats for command sender
        userId = ctx.from.id.toString();
        username = ctx.from.username || ctx.from.first_name || 'Unknown';
    }
    
    const userData = await getUserData(groupId, userId, username);
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
        // Initialize database schema
        await initializeDatabase();
        
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