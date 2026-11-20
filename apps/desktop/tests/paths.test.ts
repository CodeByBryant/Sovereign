import { describe, expect, it } from 'vitest'
import { posix, win32 } from 'node:path'
import { isAppUrl, resolveWebEntry } from '../src/paths'

describe('resolveWebEntry', () => {
  it('in development, finds the web build next to this app in the workspace', () => {
    expect(
      resolveWebEntry(
        { isPackaged: false, resourcesPath: '/ignored', mainDir: '/repo/apps/desktop/dist' },
        posix
      )
    ).toBe('/repo/apps/web/dist/index.html')
  })

  it('when packaged, uses the web build shipped in the app resources', () => {
    expect(
      resolveWebEntry(
        { isPackaged: true, resourcesPath: '/opt/Sovereign/resources', mainDir: '/ignored' },
        posix
      )
    ).toBe('/opt/Sovereign/resources/web/index.html')
  })

  it("uses the platform's path rules (Windows)", () => {
    expect(
      resolveWebEntry(
        {
          isPackaged: true,
          resourcesPath: 'C:\\Program Files\\Sovereign\\resources',
          mainDir: 'x'
        },
        win32
      )
    ).toBe('C:\\Program Files\\Sovereign\\resources\\web\\index.html')
    expect(
      resolveWebEntry(
        { isPackaged: false, resourcesPath: 'x', mainDir: 'C:\\repo\\apps\\desktop\\dist' },
        win32
      )
    ).toBe('C:\\repo\\apps\\web\\dist\\index.html')
  })
})

describe('isAppUrl (the only addresses the window may show)', () => {
  const entry = '/opt/Sovereign/resources/web/index.html'

  it('allows the app page, with a query or fragment', () => {
    expect(isAppUrl('file:///opt/Sovereign/resources/web/index.html', entry, posix)).toBe(true)
    expect(isAppUrl('file:///opt/Sovereign/resources/web/index.html?debug#x', entry, posix)).toBe(
      true
    )
  })

  it('allows files inside the web build (scripts, workers, styles)', () => {
    expect(
      isAppUrl('file:///opt/Sovereign/resources/web/assets/world.worker-1.js', entry, posix)
    ).toBe(true)
  })

  it('refuses other files on disk, including look-alike directories and parent traversal', () => {
    expect(isAppUrl('file:///etc/passwd', entry, posix)).toBe(false)
    expect(isAppUrl('file:///opt/Sovereign/resources/web-evil/index.html', entry, posix)).toBe(
      false
    )
    expect(isAppUrl('file:///opt/Sovereign/resources/web/../secrets.txt', entry, posix)).toBe(false)
    expect(isAppUrl('file:///opt/Sovereign/resources/web/%2e%2e/secrets.txt', entry, posix)).toBe(
      false
    )
  })

  it('refuses the web, and anything that is not a file URL', () => {
    expect(isAppUrl('https://example.com/', entry, posix)).toBe(false)
    expect(isAppUrl('http://localhost:5000/', entry, posix)).toBe(false)
    expect(isAppUrl('javascript:alert(1)', entry, posix)).toBe(false)
    expect(isAppUrl('data:text/html,<h1>x</h1>', entry, posix)).toBe(false)
  })

  it('refuses a value that is not a URL at all', () => {
    expect(isAppUrl('not a url', entry, posix)).toBe(false)
    expect(isAppUrl('', entry, posix)).toBe(false)
  })

  it('works with Windows paths', () => {
    const winEntry = 'C:\\Program Files\\Sovereign\\resources\\web\\index.html'
    expect(
      isAppUrl('file:///C:/Program%20Files/Sovereign/resources/web/assets/a.js', winEntry, win32)
    ).toBe(true)
    expect(isAppUrl('file:///C:/Windows/System32/x.dll', winEntry, win32)).toBe(false)
    // a different drive has no relative path to the app, only an absolute one
    expect(isAppUrl('file:///D:/Sovereign/resources/web/index.html', winEntry, win32)).toBe(false)
  })
})
