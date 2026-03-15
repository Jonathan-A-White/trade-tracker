Feature: Dark Mode
  As a user
  I want to toggle between light and dark themes
  So that I can use the app comfortably in different lighting conditions

  Background:
    Given the app is loaded

  # From commit: Add dark mode support with theme toggle
  Scenario: Toggle dark mode on
    Given the app is in light mode
    When I navigate to the Settings page
    And I tap the dark mode toggle
    Then the app switches to dark mode
    And all UI components use dark theme colors
    And the preference is saved to localStorage

  # From commit: Add dark mode support with theme toggle
  Scenario: Toggle dark mode off
    Given the app is in dark mode
    When I navigate to the Settings page
    And I tap the dark mode toggle
    Then the app switches to light mode
    And all UI components use light theme colors

  # From commit: Add dark mode support with theme toggle
  Scenario: Dark mode persists across sessions
    Given I have previously enabled dark mode
    When I reload the app
    Then the app starts in dark mode

  # From commit: Add dark mode support with theme toggle
  Scenario: Dark mode respects system preference on first load
    Given this is a fresh install with no saved theme preference
    And the system color scheme is set to dark
    When I load the app for the first time
    Then the app starts in dark mode

  # From commit: Add dark mode support with theme toggle
  Scenario: Charts adapt to dark mode
    Given the app is in dark mode
    When I view a price history chart
    Then the chart colors are adapted for dark backgrounds
    And text labels are readable against the dark background

  # From commit: Remove theme toggle from page headers
  Scenario: Theme toggle is only in Settings
    When I navigate to any page with a header
    Then the header does not contain a theme toggle button
    And the theme toggle is only available on the Settings page
