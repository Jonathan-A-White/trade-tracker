Feature: Store Management
  As a grocery shopper
  I want to manage my list of stores
  So that I can track trips and prices by store

  Background:
    Given the app is loaded

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View stores list
    Given I have stores "Trader Joe's", "Costco", and "Whole Foods"
    When I navigate to the Stores page
    Then I see all 3 stores listed alphabetically
    And each store shows the number of associated trips

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Create a new store
    When I navigate to the New Store page
    And I enter the store name "Aldi"
    And I optionally enter notes "Discount grocery store"
    And I tap "Save"
    Then the store "Aldi" is created
    And I am navigated back to the Stores page

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Edit a store
    Given I have a store "Trader Joes" (misspelled)
    When I navigate to the Edit Store page for "Trader Joes"
    And I change the name to "Trader Joe's"
    And I tap "Save"
    Then the store name is updated to "Trader Joe's"

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View empty stores list
    Given I have no stores
    When I navigate to the Stores page
    Then I see an empty state message
    And I see a button to add a new store
