import { Page } from 'rebrowser-playwright'

import { isInvalidPage } from '../../util/validation/PageValidator'
import { Workers } from '../Workers'


export class UrlReward extends Workers {

    async doUrlReward(page: Page) {
        this.bot.log(this.bot.isMobile, 'URL-REWARD', 'Trying to complete UrlReward')

        try {
            // Check for invalid page before attempting activity
            const pageCheck = await isInvalidPage(page)
            if (pageCheck.invalid) {
                this.bot.log(this.bot.isMobile, 'URL-REWARD', `Invalid page detected: ${pageCheck.reason}, aborting`, 'warn')
                await page.close()
                return
            }

            await this.bot.utils.wait(2000)

            await page.close()

            this.bot.log(this.bot.isMobile, 'URL-REWARD', 'Completed the UrlReward successfully')
        } catch (error) {
            await page.close()
            this.bot.log(this.bot.isMobile, 'URL-REWARD', 'An error occurred:' + error, 'error')
        }
    }

}