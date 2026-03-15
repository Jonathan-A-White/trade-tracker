Feature: Progressive Web App (PWA)
  As a mobile user
  I want to install the app on my device
  So that I can use it like a native app with offline support

  Background:
    Given the app is loaded in a supported browser

  # From commit: Add PWA icons, dark mode toggle in header, catch-all 404 route, and settings page
  Scenario: App has PWA manifest with icons
    Then the app includes a web manifest
    And the manifest contains a 192x192 icon
    And the manifest contains a 512x512 icon

  # From commit: Make app installable as fullscreen PWA with custom icon
  Scenario: App is installable as fullscreen PWA
    Then the app meets PWA installability criteria
    And the display mode is set to "standalone"
    And the app opens in fullscreen mode when installed

  # From commit: Fix PWA installability and fullscreen mode
  Scenario: PWA installs and runs correctly
    When the user installs the app
    Then the app launches without a browser address bar
    And the app fills the full screen
    And the status bar is themed to match the app

  # From commit: Fix 404 errors on GitHub Pages for SPA client-side routing
  Scenario: Client-side routing works on refresh
    Given I am on the Trip History page at "/trips/history"
    When I refresh the browser
    Then the app loads correctly on the Trip History page
    And I do not see a 404 error

  # From commit: Add PWA icons, dark mode toggle in header, catch-all 404 route, and settings page
  Scenario: Unknown routes show 404 page
    When I navigate to a non-existent route "/nonexistent"
    Then I see a Not Found page
    And I see a link to navigate back to the Home page

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: App works offline with IndexedDB
    Given I have previously loaded the app and cached resources
    When I lose internet connection
    Then I can still access my stored data
    And I can create trips and add items offline
