"""Local browser tests for Auntie & Uncle marketplace v0.2. python tests/smoke.py"""
from pathlib import Path
import asyncio
from playwright.async_api import async_playwright

BASE = Path(__file__).resolve().parents[1]
OUT = BASE.parent


def embedded_html():
    html = (BASE / 'index.html').read_text(encoding='utf-8')
    css = (BASE / 'styles.css').read_text(encoding='utf-8')
    js = (BASE / 'app.js').read_text(encoding='utf-8')
    return html.replace('<link rel="stylesheet" href="styles.css">', f'<style>{css}</style>').replace('<script src="app.js" defer></script>', '').replace('</body>', f'<script>{js}</script></body>')


async def run():
    async with async_playwright() as playwright:
        launch = {'headless': True, 'args': ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']}
        if Path('/usr/bin/chromium').exists(): launch['executable_path'] = '/usr/bin/chromium'
        browser = await playwright.chromium.launch(**launch)
        html = embedded_html()
        js_errors = []
        page = await browser.new_page(viewport={'width':1440,'height':900}, device_scale_factor=1)
        page.on('pageerror', lambda error: js_errors.append(str(error)))
        await page.set_content(html, wait_until='load')

        assert await page.locator('.service-card').count() == 6
        assert await page.locator('.helper-card').count() == 8
        assert 'fictional helper profiles' in (await page.locator('.market-summary').inner_text())
        assert 'Marketplace status:' in (await page.locator('.demo-label').inner_text())
        await page.locator('[data-filter="family"]').click()
        assert await page.locator('.service-card:visible').count() == 2
        await page.locator('[data-filter="all"]').click()
        await page.locator('#helper-category').select_option('Cleaning')
        assert await page.locator('.helper-card').count() == 2
        await page.locator('#helper-area').fill('Randburg')
        assert await page.locator('.helper-card').count() == 1
        assert 'Thandi M.' in await page.locator('.helper-grid').inner_text()
        await page.locator('#helper-category').select_option('Gardening')
        assert await page.locator('#market-empty').is_visible()
        await page.locator('#empty-reset').click()
        assert await page.locator('.helper-card').count() == 8
        await page.locator('#helper-sort').select_option('rate-low')
        assert 'Kabelo R.' in await page.locator('.helper-card').first.inner_text()
        await page.locator('#reset-search').click()

        # Service shortcut performs discovery instead of sending a request.
        await page.locator('.service-link[data-service="Childcare"]').click()
        assert await page.locator('#helper-category').input_value() == 'Childcare'
        assert await page.locator('.helper-card').count() == 1
        assert await page.locator('#service').input_value() == 'Childcare'
        await page.locator('.profile-button').first.click()
        assert await page.locator('#helper-dialog').is_visible()
        assert 'No screening' in await page.locator('.profile-disclaimer').inner_text()
        await page.get_by_role('button', name='Request this helper').click()
        assert not await page.locator('#helper-dialog').is_visible()
        assert 'Nomusa K.' in await page.locator('#selected-provider-name').inner_text()
        assert await page.locator('#area').input_value() == 'Soweto'

        # Booking requires details, and must not submit to any real endpoint.
        await page.locator('#enquiry-form .form-submit').click()
        assert await page.locator('#form-error').is_visible()
        await page.locator('#details').fill('Please help with a school holiday childcare arrangement.')
        await page.locator('#booking-hours').fill('3')
        await page.locator('#enquiry-form .form-submit').click()
        assert await page.locator('#request-result').is_visible()
        preview = await page.locator('#request-preview').inner_text()
        assert 'Nomusa K. (fictional)' in preview and 'DEMO ONLY' in preview and '3' in preview
        assert not await page.locator('#whatsapp-request').is_visible()
        await page.locator('#edit-request').click()
        assert await page.locator('#enquiry-form').is_visible()
        await page.locator('#clear-provider').click()
        assert not await page.locator('#selected-provider').is_visible()

        # Helper self-onboarding is a preview, not account creation.
        await page.locator('#helper-join-form button[type=submit]').click()
        assert await page.locator('#join-error').is_visible()
        await page.locator('#join-name').fill('Example Helper')
        await page.locator('#join-service').select_option('Gardening')
        await page.locator('#join-area').fill('Kempton Park')
        await page.locator('#join-rate').fill('180')
        await page.locator('#join-bio').fill('General garden tidying and regular upkeep.')
        await page.locator('#helper-join-form button[type=submit]').click()
        assert await page.locator('#join-preview').is_visible()
        assert 'Example Helper' in await page.locator('#join-preview').inner_text()
        assert 'not public' in await page.locator('#join-preview').inner_text()
        await page.locator('#edit-join').click()
        assert await page.locator('#helper-join-form').is_visible()

        # Dashboard sample state transitions; reversible, no booking persisted.
        assert 'Pending' in await page.locator('#demo-status').inner_text()
        await page.locator('#demo-accept').click()
        assert 'Accepted in this demo' in await page.locator('#demo-status').inner_text()
        assert await page.locator('#demo-decline').is_disabled()
        await page.locator('#demo-reset').click()
        assert await page.locator('#demo-accept').is_enabled()
        await page.locator('#demo-decline').click()
        assert 'Declined in this demo' in await page.locator('#demo-status').inner_text()
        await page.locator('#demo-reset').click()

        # New viewport: snapshots, no data entry or browser storage.
        snapshots = [(1440,'desktop'),(390,'mobile')]
        for width, label in snapshots:
            shot = await browser.new_page(viewport={'width':width,'height':900 if width > 500 else 844}, device_scale_factor=1)
            shot.on('pageerror', lambda error: js_errors.append(str(error)))
            await shot.set_content(html, wait_until='load')
            await shot.screenshot(path=str(OUT / f'auntie-uncle-marketplace-{label}.png'))
            await shot.locator('#browse').scroll_into_view_if_needed()
            await shot.evaluate("document.documentElement.style.scrollBehavior='auto'; document.querySelector('#browse').scrollIntoView()")
            await shot.screenshot(path=str(OUT / f'auntie-uncle-marketplace-directory-{label}.png'))
            if width == 390:
                await shot.evaluate('window.scrollTo(0,0)')
                await shot.locator('#menu-toggle').click()
                assert await shot.locator('#primary-nav').is_visible()
                await shot.locator('#primary-nav a[href="#join"]').click()
                assert await shot.locator('#menu-toggle').get_attribute('aria-expanded') == 'false'
            await shot.close()

        for width in [320,375,390,650,768,870,1024,1280,1440,1920]:
            check = await browser.new_page(viewport={'width':width,'height':850})
            check.on('pageerror', lambda error: js_errors.append(str(error)))
            await check.set_content(html, wait_until='load')
            scroll_width = await check.evaluate('document.documentElement.scrollWidth')
            if scroll_width > width:
                print('OVERFLOW', width, scroll_width, await check.evaluate("[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right > innerWidth+1).map(e=>({tag:e.tagName,cls:e.className?.baseVal||e.className,txt:e.textContent.slice(0,35),right:Math.round(e.getBoundingClientRect().right)})).slice(0,15)"))
            assert scroll_width <= width, f'Horizontal overflow {width}px: {scroll_width}'
            await check.close()
        assert not js_errors, f'Unexpected JS errors: {js_errors}'
        await browser.close()
        print('PASS: categories, matching, sorting, empty state, profile dialog, booking draft, helper preview, dashboard, mobile nav, ten screen widths, no JS errors')

if __name__ == '__main__': asyncio.run(run())
