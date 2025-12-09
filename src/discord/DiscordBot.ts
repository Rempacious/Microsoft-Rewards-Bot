/**
 * Discord Bot for controlling Microsoft Rewards Bot via slash commands
 * 
 * Features:
 * - Slash commands for run/stop/status/restart/schedule/accounts/help
 * - Permission control via allowedUserIds
 * - Integration with InternalScheduler and BotController
 */
import {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    EmbedBuilder,
    type ChatInputCommandInteraction,
    type Interaction
} from 'discord.js'
import type { Config } from '../interface/Config'
import type { InternalScheduler } from '../scheduler/InternalScheduler'
import { botController } from '../dashboard/BotController'
import { loadAccounts } from '../util/state/Load'
import { log } from '../util/notifications/Logger'
import { commands, commandDescriptions } from './commands'
import { DISCORD } from '../constants'

export class DiscordBot {
    private client: Client
    private config: Config
    private scheduler: InternalScheduler | null
    private _isReady: boolean = false

    constructor(config: Config, scheduler: InternalScheduler | null = null) {
        this.config = config
        this.scheduler = scheduler

        this.client = new Client({
            intents: [GatewayIntentBits.Guilds]
        })

        this.setupEventHandlers()
    }

    /**
     * Check if bot is connected and ready
     */
    public get isReady(): boolean {
        return this._isReady
    }

    /**
     * Start the Discord bot
     */
    public async start(): Promise<boolean> {
        const discordConfig = this.config.discordBot
        if (!discordConfig?.enabled) {
            this.log('Discord bot disabled in config', 'warn')
            return false
        }

        const token = discordConfig.token || process.env.DISCORD_BOT_TOKEN
        if (!token) {
            this.log('No Discord bot token provided (set discordBot.token or DISCORD_BOT_TOKEN env var)', 'error')
            return false
        }

        try {
            // Register slash commands
            await this.registerCommands(token)

            // Login to Discord
            await this.client.login(token)

            this.log('Discord bot started successfully', 'log')
            return true
        } catch (error) {
            this.log(`Failed to start Discord bot: ${error instanceof Error ? error.message : String(error)}`, 'error')
            return false
        }
    }

    /**
     * Stop the Discord bot
     */
    public async stop(): Promise<void> {
        if (this.client) {
            this.client.destroy()
            this._isReady = false
            this.log('Discord bot stopped', 'warn')
        }
    }

    /**
     * Register slash commands with Discord
     */
    private async registerCommands(token: string): Promise<void> {
        const rest = new REST({ version: '10' }).setToken(token)

        // Extract application ID from token (first part before the first dot is base64-encoded app ID)
        const applicationId = this.extractApplicationId(token)
        if (!applicationId) {
            throw new Error('Invalid Discord token format - cannot extract application ID')
        }

        const commandData = commands.map(cmd => cmd.toJSON())

        // If guildId is provided, register to specific guild (instant)
        // Otherwise register globally (can take up to 1 hour to propagate)
        const guildId = this.config.discordBot?.guildId

        if (guildId) {
            // Guild-specific (instant registration)
            await rest.put(
                Routes.applicationGuildCommands(applicationId, guildId),
                { body: commandData }
            )
            this.log(`Registered ${commands.length} slash commands to guild ${guildId}`)
        } else {
            // Global registration (may take up to 1 hour)
            await rest.put(
                Routes.applicationCommands(applicationId),
                { body: commandData }
            )
            this.log(`Registered ${commands.length} global slash commands (may take up to 1 hour to propagate)`)
        }
    }

    /**
     * Extract application ID from Discord bot token
     * Token format: base64(applicationId).timestamp.hmac
     */
    private extractApplicationId(token: string): string | null {
        try {
            const parts = token.split('.')
            if (parts.length !== 3) return null

            // First part is base64-encoded application ID
            const decoded = Buffer.from(parts[0]!, 'base64').toString('utf-8')
            // Validate it's a numeric ID (snowflake)
            if (!/^\d+$/.test(decoded)) return null

            return decoded
        } catch {
            return null
        }
    }

    /**
     * Setup Discord event handlers
     */
    private setupEventHandlers(): void {
        this.client.once('ready', () => {
            this._isReady = true
            this.log(`Logged in as ${this.client.user?.tag}`, 'log')
        })

        this.client.on('interactionCreate', async (interaction: Interaction) => {
            if (!interaction.isChatInputCommand()) return

            // Check permissions
            if (!this.hasPermission(interaction)) {
                await interaction.reply({
                    content: '❌ You do not have permission to use this bot.',
                    ephemeral: true
                })
                return
            }

            await this.handleCommand(interaction)
        })

        this.client.on('error', (error) => {
            this.log(`Discord client error: ${error.message}`, 'error')
        })
    }

    /**
     * Check if user has permission to control the bot
     */
    private hasPermission(interaction: ChatInputCommandInteraction): boolean {
        const allowedUserIds = this.config.discordBot?.allowedUserIds || []

        // If no users configured, allow all (not recommended)
        if (allowedUserIds.length === 0) {
            return true
        }

        // Convert to strings for comparison (config may have numbers)
        const allowedStrings = allowedUserIds.map(id => String(id))
        return allowedStrings.includes(interaction.user.id)
    }

    /**
     * Handle slash commands
     */
    private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const { commandName } = interaction

        try {
            switch (commandName) {
                case 'run':
                    await this.handleRun(interaction)
                    break
                case 'status':
                    await this.handleStatus(interaction)
                    break
                case 'accounts':
                    await this.handleAccounts(interaction)
                    break
                case 'stop':
                    await this.handleStop(interaction)
                    break
                case 'restart':
                    await this.handleRestart(interaction)
                    break
                case 'schedule':
                    await this.handleSchedule(interaction)
                    break
                case 'help':
                    await this.handleHelp(interaction)
                    break
                default:
                    await interaction.reply({
                        content: `Unknown command: ${commandName}`,
                        ephemeral: true
                    })
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            this.log(`Command error (${commandName}): ${errorMsg}`, 'error')

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: `❌ Error: ${errorMsg}`,
                    ephemeral: true
                })
            } else {
                await interaction.reply({
                    content: `❌ Error: ${errorMsg}`,
                    ephemeral: true
                })
            }
        }
    }

    /**
     * /run - Trigger immediate bot execution
     */
    private async handleRun(interaction: ChatInputCommandInteraction): Promise<void> {
        const status = botController.getStatus()

        if (status.running) {
            await interaction.reply({
                embeds: [this.createEmbed('⚠️ Bot Already Running', 'The bot is currently running. Use `/stop` first if you want to restart.', DISCORD.COLOR_ORANGE)],
                ephemeral: true
            })
            return
        }

        await interaction.deferReply()

        const result = await botController.start()

        if (result.success) {
            await interaction.editReply({
                embeds: [this.createEmbed('🚀 Bot Started', 'Microsoft Rewards Bot has been triggered. Use `/status` to monitor progress.', DISCORD.COLOR_GREEN)]
            })
        } else {
            await interaction.editReply({
                embeds: [this.createEmbed('❌ Failed to Start', result.error || 'Unknown error', DISCORD.COLOR_RED)]
            })
        }
    }

    /**
     * /status - Show bot status
     */
    private async handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
        const status = botController.getStatus()
        const schedulerStatus = this.scheduler?.getStatus()

        const fields = [
            { name: '🔄 Status', value: status.running ? '🟢 Running' : '⚪ Idle', inline: true },
            { name: '🔧 PID', value: String(status.pid || 'N/A'), inline: true }
        ]

        if (status.uptime) {
            const uptimeStr = this.formatUptime(status.uptime)
            fields.push({ name: '⏱️ Uptime', value: uptimeStr, inline: true })
        }

        if (status.startTime) {
            fields.push({ name: '🕐 Started', value: new Date(status.startTime).toLocaleString(), inline: true })
        }

        if (schedulerStatus) {
            fields.push({ name: '📅 Scheduler', value: schedulerStatus.active ? '🟢 Active' : '⚪ Inactive', inline: true })
            if (schedulerStatus.nextRun) {
                fields.push({ name: '⏰ Next Run', value: schedulerStatus.nextRun, inline: true })
            }
            if (schedulerStatus.lastRun) {
                fields.push({ name: '📆 Last Run', value: schedulerStatus.lastRun, inline: true })
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('📊 Bot Status')
            .setColor(status.running ? DISCORD.COLOR_GREEN : DISCORD.COLOR_GRAY)
            .addFields(fields)
            .setTimestamp()

        await interaction.reply({ embeds: [embed] })
    }

    /**
     * /accounts - List configured accounts
     */
    private async handleAccounts(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const accounts = loadAccounts()

            if (accounts.length === 0) {
                await interaction.reply({
                    embeds: [this.createEmbed('👥 Accounts', 'No accounts configured.', DISCORD.COLOR_GRAY)],
                    ephemeral: true
                })
                return
            }

            const accountList = accounts.map((acc, idx) => {
                // Redact email: show first 2 chars and domain
                const email = acc.email
                const [local, domain] = email.split('@')
                const redacted = local && domain
                    ? `${local.substring(0, 2)}***@${domain}`
                    : '***@***'
                return `${idx + 1}. ${redacted}`
            }).join('\n')

            const embed = new EmbedBuilder()
                .setTitle('👥 Configured Accounts')
                .setDescription(accountList)
                .setColor(DISCORD.COLOR_BLUE)
                .setFooter({ text: `Total: ${accounts.length} account(s)` })
                .setTimestamp()

            await interaction.reply({ embeds: [embed], ephemeral: true })
        } catch (error) {
            await interaction.reply({
                embeds: [this.createEmbed('❌ Error', `Failed to load accounts: ${error instanceof Error ? error.message : String(error)}`, DISCORD.COLOR_RED)],
                ephemeral: true
            })
        }
    }

    /**
     * /stop - Stop bot execution
     */
    private async handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
        const status = botController.getStatus()

        if (!status.running) {
            await interaction.reply({
                embeds: [this.createEmbed('ℹ️ Not Running', 'The bot is not currently running.', DISCORD.COLOR_GRAY)],
                ephemeral: true
            })
            return
        }

        const result = botController.stop()

        if (result.success) {
            await interaction.reply({
                embeds: [this.createEmbed('🛑 Bot Stopped', 'The bot will complete its current task and then stop.', DISCORD.COLOR_ORANGE)]
            })
        } else {
            await interaction.reply({
                embeds: [this.createEmbed('❌ Failed to Stop', result.error || 'Unknown error', DISCORD.COLOR_RED)]
            })
        }
    }

    /**
     * /restart - Restart the bot
     */
    private async handleRestart(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply()

        const result = await botController.restart()

        if (result.success) {
            await interaction.editReply({
                embeds: [this.createEmbed('🔄 Bot Restarted', 'Microsoft Rewards Bot has been restarted.', DISCORD.COLOR_GREEN)]
            })
        } else {
            await interaction.editReply({
                embeds: [this.createEmbed('❌ Failed to Restart', result.error || 'Unknown error', DISCORD.COLOR_RED)]
            })
        }
    }

    /**
     * /schedule - Show next scheduled run
     */
    private async handleSchedule(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.scheduler) {
            await interaction.reply({
                embeds: [this.createEmbed('⏰ Scheduler', 'Scheduler is not enabled in configuration.', DISCORD.COLOR_GRAY)],
                ephemeral: true
            })
            return
        }

        const status = this.scheduler.getStatus()

        const embed = new EmbedBuilder()
            .setTitle('⏰ Scheduler Information')
            .setColor(status.active ? DISCORD.COLOR_BLUE : DISCORD.COLOR_GRAY)
            .addFields([
                { name: '📅 Status', value: status.active ? '🟢 Active' : '⚪ Inactive', inline: true },
                { name: '🔄 Currently Running', value: status.isRunning ? 'Yes' : 'No', inline: true },
                { name: '⏰ Next Run', value: status.nextRun || 'N/A', inline: false },
                { name: '📆 Last Run', value: status.lastRun || 'Never', inline: false }
            ])
            .setTimestamp()

        await interaction.reply({ embeds: [embed] })
    }

    /**
     * /help - Show available commands
     */
    private async handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
        const commandList = Object.entries(commandDescriptions)
            .map(([cmd, desc]) => `\`/${cmd}\` - ${desc}`)
            .join('\n')

        const embed = new EmbedBuilder()
            .setTitle('❓ Available Commands')
            .setDescription(commandList)
            .setColor(DISCORD.COLOR_BLUE)
            .setFooter({ text: 'Microsoft Rewards Bot Discord Controller' })
            .setTimestamp()

        await interaction.reply({ embeds: [embed] })
    }

    /**
     * Create a simple embed
     */
    private createEmbed(title: string, description: string, color: number): EmbedBuilder {
        return new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp()
    }

    /**
     * Format uptime in human readable format
     */
    private formatUptime(ms: number): string {
        const seconds = Math.floor(ms / 1000)
        const minutes = Math.floor(seconds / 60)
        const hours = Math.floor(minutes / 60)
        const days = Math.floor(hours / 24)

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`
        if (hours > 0) return `${hours}h ${minutes % 60}m`
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`
        return `${seconds}s`
    }

    /**
     * Log helper
     */
    private log(message: string, level: 'log' | 'warn' | 'error' = 'log'): void {
        log('main', 'DISCORD-BOT', message, level)
    }
}
