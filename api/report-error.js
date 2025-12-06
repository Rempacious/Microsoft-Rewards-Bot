const { randomUUID } = require('crypto')

const MAX_BODY_SIZE = 10000
const MAX_TEXT = 900
const MAX_FIELD = 120
const MAX_STACK_LINES = 8
const AUTH_HEADER = 'x-error-report-token'

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function trimAndLimit(value, limit) {
    if (typeof value !== 'string') {
        return ''
    }
    const trimmed = value.trim()
    return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed
}

function formatMetadata(metadata) {
    if (!isPlainObject(metadata)) {
        return 'Not provided'
    }
    const entries = Object.entries(metadata).filter(([key, val]) => typeof key === 'string' && (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'))
    if (entries.length === 0) {
        return 'Not provided'
    }
    const limited = entries.slice(0, 6)
    const lines = limited.map(([key, val]) => {
        const valueText = trimAndLimit(String(val), MAX_FIELD)
        return `${trimAndLimit(key, MAX_FIELD)}: ${valueText}`
    })
    return lines.join('\n')
}

async function readJsonBody(req) {
    if (req.body) {
        return req.body
    }
    let data = ''
    for await (const chunk of req) {
        data += chunk
        if (data.length > MAX_BODY_SIZE) {
            throw new Error('Payload too large')
        }
    }
    if (!data) {
        return {}
    }
    return JSON.parse(data)
}

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST')
        res.status(405).json({ error: 'Method not allowed' })
        return
    }

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL
    const authToken = process.env.ERROR_REPORT_TOKEN

    if (!webhookUrl) {
        res.status(500).json({ error: 'Webhook not configured' })
        return
    }

    if (!authToken) {
        res.status(500).json({ error: 'Reporting token not configured' })
        return
    }

    const providedHeader = req.headers?.[AUTH_HEADER]
    const providedToken = Array.isArray(providedHeader) ? providedHeader[0] : providedHeader

    if (!providedToken || providedToken !== authToken) {
        res.status(401).json({ error: 'Unauthorized' })
        return
    }

    let body
    try {
        body = await readJsonBody(req)
    } catch (error) {
        res.status(400).json({ error: 'Invalid JSON body' })
        return
    }

    const errorText = trimAndLimit(body.error, MAX_TEXT)
    if (!errorText) {
        res.status(400).json({ error: 'Field \'error\' is required' })
        return
    }

    const summary = trimAndLimit(body.summary || body.message || '', 140)
    const errorType = trimAndLimit(body.type || 'unspecified', 80)
    const environment = trimAndLimit((body.environment && (body.environment.name || body.environment)) || process.env.VERCEL_ENV || process.env.NODE_ENV || 'unspecified', 80)
    const metadata = formatMetadata(body.metadata)
    const stackSnippet = Array.isArray(body.stack)
        ? body.stack.slice(0, MAX_STACK_LINES).join('\n')
        : trimAndLimit(typeof body.stack === 'string' ? body.stack.split('\n').slice(0, MAX_STACK_LINES).join('\n') : '', MAX_TEXT)
    const requestId = randomUUID()

    const embed = {
        title: 'Error Report',
        description: summary || 'Automated error report received',
        color: 0xef4444,
        fields: [
            { name: 'Error', value: errorText, inline: false },
            { name: 'Type', value: errorType, inline: true },
            { name: 'Environment', value: environment, inline: true },
            { name: 'Request ID', value: requestId, inline: true }
        ],
        footer: { text: 'Microsoft Rewards Bot' },
        timestamp: new Date().toISOString()
    }

    if (metadata && metadata !== 'Not provided') {
        embed.fields.push({ name: 'Metadata', value: metadata, inline: false })
    }

    if (stackSnippet) {
        embed.fields.push({ name: 'Stack (truncated)', value: stackSnippet })
    }

    const payload = { embeds: [embed] }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        if (!response.ok) {
            res.status(502).json({ error: 'Failed to deliver report' })
            return
        }

        res.status(200).json({ status: 'reported' })
    } catch (error) {
        res.status(502).json({ error: 'Failed to deliver report' })
    }
}
