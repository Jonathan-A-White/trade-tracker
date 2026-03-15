Feature: Item Management
  As a grocery shopper
  I want to manage my item library
  So that I can track products and their prices over time

  Background:
    Given the app is loaded

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View item library
    Given I have items "Bananas", "Milk", and "Bread" in my library
    When I navigate to the Items page
    Then I see all 3 items listed
    And each item shows its name, price, and category

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Create a new item manually
    When I navigate to the New Item page
    And I enter the name "Organic Eggs"
    And I enter the barcode "012345678901"
    And I enter the price "$5.99"
    And I select unit type "each"
    And I tap "Save"
    Then the item "Organic Eggs" is created in the database
    And I am navigated back to the item library

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Create a per-pound item
    When I navigate to the New Item page
    And I enter the name "Chicken Breast"
    And I enter the price "$6.99"
    And I select unit type "per_lb"
    And I tap "Save"
    Then the item "Chicken Breast" is created with unit type "per_lb"

  # From commit: Improve barcode field UI to indicate PLU codes are accepted
  Scenario: PLU code recognition in item form
    When I navigate to the New Item page
    And I enter the barcode "4011"
    Then I see a hint indicating PLU codes are accepted
    And the barcode field label indicates "Barcode / PLU Code"

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View item detail with price history
    Given I have an item "Bananas" with price history across 5 trips
    When I tap on "Bananas" in the item library
    Then I see the item detail page
    And I see the current price per unit
    And I see the unit type
    And I see a price history chart showing trends over time

  # From commit: Make search bar sticky at top of Items page
  Scenario: Search bar stays sticky while scrolling items
    Given I have many items in my library
    When I navigate to the Items page
    And I scroll down through the item list
    Then the search bar remains fixed at the top of the page

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Search items by name
    Given I have items "Bananas", "Banana Chips", "Bread", and "Butter"
    When I navigate to the Items page
    And I type "Banana" in the search bar
    Then I see "Bananas" and "Banana Chips" in the results
    And I do not see "Bread" or "Butter"

  # From commit: Remove unused picture field from Item interface
  Scenario: Item interface does not include picture field
    When I create a new item
    Then the item form does not show a picture upload field
    And the item is saved without a picture property

  # From commit: Add grocery category autocomplete with typeahead search
  Scenario: Category autocomplete when creating an item
    Given I have items with categories "Produce", "Dairy", and "Bakery"
    When I navigate to the New Item page
    And I start typing "Pro" in the category field
    Then I see a dropdown suggestion showing "Produce"
    When I select "Produce"
    Then the category field is populated with "Produce"

  # From commit: Add grocery category autocomplete with typeahead search
  Scenario: Category autocomplete shows all matching categories
    Given I have items with categories "Produce", "Protein", and "Dairy"
    When I start typing "Pro" in the category field
    Then I see suggestions for "Produce" and "Protein"
    But I do not see "Dairy"
