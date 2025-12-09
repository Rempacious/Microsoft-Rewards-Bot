/**
 * Discord slash command definitions for bot control
 */
import { SlashCommandBuilder } from 'discord.js'

export const commands = [
    new SlashCommandBuilder()
        .setName('run')
        .setDescription('Trigger an immediate bot execution'),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show bot status and scheduler info'),

    new SlashCommandBuilder()
        .setName('accounts')
        .setDescription('List configured accounts (emails redacted)'),

    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop the current bot execution'),

    new SlashCommandBuilder()
        .setName('restart')
        .setDescription('Restart the bot'),

    new SlashCommandBuilder()
        .setName('schedule')
        .setDescription('Show next scheduled run time'),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show available commands')
]

export const commandDescriptions: Record<string, string> = {
    run: '🚀 Trigger an immediate bot execution',
    status: '📊 Show bot status (running/idle, uptime, last run)',
    accounts: '👥 List configured accounts (emails redacted)',
    stop: '🛑 Stop the current bot execution',
    restart: '🔄 Restart the bot',
    schedule: '⏰ Show next scheduled run time',
    help: '❓ Show all available commands'
}
