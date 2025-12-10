import { Page } from 'rebrowser-playwright'
import { load } from 'cheerio'
import { MicrosoftRewardsBot } from '../../index'
import { waitForPageReady } from '../browser/SmartWait'

/**
 * Page validation utility to detect invalid pages and handle redirects
 */

/**
 * Check if URL is on a valid rewards domain
 */
export function isRewardsDomain(url: string): boolean {
    return url.includes('rewards.bing.com') || url.includes('rewards.microsoft.com')
}

/**
 * Check if URL is a valid Bing domain (for activities)
 */
export function isBingDomain(url: string): boolean {
    return url.includes('bing.com')
}

/**
 * Detect if page is in an invalid state (network error, HTTP error, blank page)
 */
export async function isInvalidPage(page: Page): Promise<{ invalid: boolean; reason?: string }> {
    try {
        const url = page.url()

        // Check for about:blank or empty URLs
        if (!url || url === 'about:blank' || url === '') {
            return { invalid: true, reason: 'blank page' }
        }

        // Check for chrome error pages
        if (url.startsWith('chrome-error://') || url.startsWith('edge://')) {
            return { invalid: true, reason: 'browser error page' }
        }

        const html = await page.content().catch(() => '')

        // Empty content
        if (!html || html.length < 100) {
            return { invalid: true, reason: 'empty page content' }
        }

        const $ = load(html)

        // Network errors (neterror class on body)
        if ($('body.neterror').length > 0) {
            return { invalid: true, reason: 'network error' }
        }

        // HTTP errors
        const errorPatterns = [
            'HTTP ERROR 400',
            'HTTP ERROR 403',
            'HTTP ERROR 404',
            'HTTP ERROR 500',
            'HTTP ERROR 502',
            'HTTP ERROR 503',
            'This page isn\'t working',
            'This page is not working',
            'This site can\'t be reached',
            'ERR_CONNECTION_REFUSED',
            'ERR_NAME_NOT_RESOLVED',
            'ERR_INTERNET_DISCONNECTED',
            'ERR_NETWORK_CHANGED',
            'ERR_CONNECTION_RESET',
            'ERR_CONNECTION_TIMED_OUT'
        ]

        const bodyText = $('body').text()
        for (const pattern of errorPatterns) {
            if (html.includes(pattern) || bodyText.includes(pattern)) {
                return { invalid: true, reason: `HTTP/network error: ${pattern}` }
            }
        }

        // Page looks valid
        return { invalid: false }
    } catch (error) {
        // If we can't even check the page, consider it invalid
        return { invalid: true, reason: `page check failed: ${error instanceof Error ? error.message : String(error)}` }
    }
}

/**
 * Check if page has valid activity content (quiz, poll, etc.)
 */
export async function hasActivityContent(page: Page): Promise<boolean> {
    try {
        const html = await page.content().catch(() => '')
        const $ = load(html)

        // Common activity selectors
        const activitySelectors = [
            '#rqStartQuiz',           // Quiz start button
            '#rqAnswerOption0',       // Quiz answer options
            '#btoption0',             // Poll options
            '.wk_OptionClickClass',   // ABC/drag-drop options
            '.rqOption',              // Generic quiz options
            'mee-card',               // Rewards card elements
            '[data-bi-area="quiz"]',  // Quiz area
            '.quizPlayground',        // Quiz playground
            '.btOptionCard'           // Option cards
        ]

        for (const selector of activitySelectors) {
            if ($(selector).length > 0) {
                return true
            }
        }

        // Also check via Playwright locator for dynamic elements
        for (const selector of activitySelectors.slice(0, 4)) {
            const found = await page.locator(selector).first().isVisible({ timeout: 500 }).catch(() => false)
            if (found) return true
        }

        return false
    } catch {
        return false
    }
}

/**
 * Validate page after button click and redirect to rewards if invalid
 * @param page The Playwright page to validate
 * @param bot The bot instance for logging and config access
 * @param closeOnInvalid If true, close the page if invalid (default: false)
 * @returns true if page is valid, false if invalid (and optionally redirected)
 */
export async function validateAndRedirect(
    page: Page,
    bot: MicrosoftRewardsBot,
    closeOnInvalid = false
): Promise<boolean> {
    const result = await isInvalidPage(page)

    if (result.invalid) {
        bot.log(bot.isMobile, 'PAGE-VALIDATOR', `Invalid page detected: ${result.reason}`, 'warn')

        if (closeOnInvalid) {
            await page.close().catch(() => { /* ignore close errors */ })
            return false
        }

        // Try to redirect to rewards home
        try {
            bot.log(bot.isMobile, 'PAGE-VALIDATOR', 'Redirecting to rewards home page...')
            await page.goto(bot.config.baseURL, { waitUntil: 'domcontentloaded', timeout: 15000 })
            await waitForPageReady(page, { timeoutMs: 10000 }).catch(() => { /* ignore timeout */ })
            return false
        } catch (navError) {
            const msg = navError instanceof Error ? navError.message : String(navError)
            bot.log(bot.isMobile, 'PAGE-VALIDATOR', `Failed to redirect to rewards: ${msg}`, 'error')
            return false
        }
    }

    return true
}

/**
 * Check if we're on an unexpected domain after clicking activity
 * If not on Bing domain, log warning and optionally redirect
 */
export async function validateActivityDomain(
    page: Page,
    bot: MicrosoftRewardsBot
): Promise<boolean> {
    const url = page.url()

    // Activity pages should be on Bing or rewards domain
    if (isBingDomain(url) || isRewardsDomain(url)) {
        return true
    }

    // On unexpected domain
    bot.log(bot.isMobile, 'PAGE-VALIDATOR', `Unexpected domain after click: ${url}`, 'warn')
    return false
}
