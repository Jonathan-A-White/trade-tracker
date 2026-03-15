Feature: App Navigation
  As a user
  I want to navigate between pages easily
  So that I can access all features of the app

  Background:
    Given the app is loaded

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Bottom navigation bar
    When I view any page
    Then I see a bottom navigation bar
    And I can navigate to Home, Items, Reports, and Settings

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Page headers with back navigation
    When I navigate to a sub-page
    Then I see a page header with the page title
    And I see a back button to return to the previous page

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Navigate to all main sections
    Then I can navigate to the following pages:
      | Page           | Path              |
      | Home           | /                 |
      | Start Trip     | /trips/new        |
      | Trip History   | /trips/history    |
      | Items          | /items            |
      | Reports        | /reports          |
      | Stores         | /stores           |
      | Settings       | /settings         |
      | Data Export     | /export           |
