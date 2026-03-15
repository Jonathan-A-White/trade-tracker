Feature: Store Management
  As a grocery shopper
  I want to manage my stores
  So that I can associate trips with specific grocery stores

  Background:
    Given the app is loaded

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: View list of stores
    Given stores "Trader Joe's" and "Whole Foods" exist
    When I navigate to the Stores page
    Then I should see "Trader Joe's" and "Whole Foods" listed
    And each store should show the trip count

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Create a new store
    When I navigate to the New Store page
    And I enter the store name "Costco"
    And I enter notes "Membership required"
    And I tap "Save"
    Then the store "Costco" should be created
    And I should see it in the Stores list

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Edit an existing store
    Given a store "Trader Joe's" exists
    When I navigate to the Edit Store page for "Trader Joe's"
    And I change the name to "Trader Joe's - Downtown"
    And I tap "Save"
    Then the store name should be updated to "Trader Joe's - Downtown"

  # Commit: Fix store click providing no visual feedback on Start Trip page
  Scenario: Store selection provides visual feedback
    Given stores "Trader Joe's" and "Whole Foods" exist
    When I navigate to the New Trip page
    And I tap on "Trader Joe's"
    Then "Trader Joe's" should be visually highlighted as selected
    And "Whole Foods" should not be highlighted
