Feature: Home Page
  As a user
  I want to see a dashboard overview when I open the app
  So that I can quickly access key information and actions

  Background:
    Given the app is loaded

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View home page with summary stats
    Given I have 5 trips, 20 items, and 3 stores
    When I navigate to the Home page
    Then I see stat cards showing trip count, item count, and store count
    And I see a "Start Trip" button

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Home page shows active trip status
    Given I have an active trip at "Trader Joe's"
    When I navigate to the Home page
    Then I see an active trip indicator
    And I can tap to resume the active trip

  # From commit: Fix View All 404 and add trip deletion
  Scenario: View All links navigate correctly
    Given I have completed trips
    When I navigate to the Home page
    And I tap "View All" for trips
    Then I am navigated to the Trip History page without a 404 error

  # From commit: Make home screen elements clickable to navigate to detail views
  Scenario: Stat cards are clickable and navigate to detail views
    Given I have trips, items, and stores
    When I tap the "Trips" stat card
    Then I am navigated to the Trip History page
    When I tap the "Items" stat card
    Then I am navigated to the Items page
    When I tap the "Stores" stat card
    Then I am navigated to the Stores page
