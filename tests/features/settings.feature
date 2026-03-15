Feature: Settings Page
  As a user
  I want to configure app settings and manage my data
  So that I can customize the app and maintain my data

  Background:
    Given the app is loaded
    And I am on the Settings page

  # From commit: Add PWA icons, dark mode toggle in header, catch-all 404 route, and settings page
  Scenario: View settings page
    Then I see the dark mode toggle
    And I see data management options
    And I see storage usage information

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View storage usage
    Given I have data stored in IndexedDB
    When I view the Settings page
    Then I see the estimated storage usage

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Clear all data
    Given I have stores, items, and trips in the database
    When I tap "Clear All Data"
    Then I see a confirmation dialog warning about data loss
    When I confirm
    Then all data is deleted from the database
    And the app returns to its initial state

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Cancel clear all data
    Given I have data in the database
    When I tap "Clear All Data"
    And I see the confirmation dialog
    When I tap "Cancel"
    Then no data is deleted
    And I remain on the Settings page
