Feature: Dark Mode
  As a user
  I want to toggle between light and dark themes
  So that I can use the app comfortably in different lighting conditions

  Background:
    Given the app is loaded

  # Commit: Add dark mode support with theme toggle
  Scenario: Toggle dark mode on
    Given the app is in light mode
    When I navigate to the Settings page
    And I toggle the dark mode switch on
    Then the app should switch to dark mode
    And all pages should use dark mode colors
    And the preference should be persisted to localStorage

  # Commit: Add dark mode support with theme toggle
  Scenario: Toggle dark mode off
    Given the app is in dark mode
    When I navigate to the Settings page
    And I toggle the dark mode switch off
    Then the app should switch to light mode
    And all pages should use light mode colors

  # Commit: Add dark mode support with theme toggle
  Scenario: Dark mode preference persists across sessions
    Given I have enabled dark mode
    When I reload the app
    Then the app should start in dark mode

  # Commit: Add dark mode support with theme toggle
  Scenario: Respect system preference on first load
    Given the user has not set a theme preference
    And the system prefers dark mode
    When the app loads for the first time
    Then the app should start in dark mode

  # Commit: Remove theme toggle from page headers
  Scenario: Theme toggle is only available in Settings
    When I navigate to any page in the app
    Then the page header should not contain a theme toggle
    When I navigate to the Settings page
    Then I should see the dark mode toggle option

  # Commit: Add dark mode support with theme toggle
  Scenario: Charts adapt to dark mode
    Given the app is in dark mode
    When I view a price history chart
    Then the chart colors should be adapted for dark backgrounds
    And the chart should remain readable
