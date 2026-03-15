Feature: Item Management
  As a grocery shopper
  I want to manage my item library
  So that I can quickly add items to trips and track prices

  Background:
    Given the app is loaded

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: View item library
    Given items exist in the database
    When I navigate to the Items page
    Then I should see a list of all items
    And each item should show its name, price, and category

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Search for an item in the library
    Given an item "Organic Bananas" exists
    And an item "Whole Milk" exists
    When I navigate to the Items page
    And I type "banana" in the search bar
    Then I should see "Organic Bananas" in the results
    And I should not see "Whole Milk" in the results

  # Commit: Make search bar sticky at top of Items page
  Scenario: Search bar stays visible while scrolling item library
    Given many items exist in the database
    When I navigate to the Items page
    And I scroll down through the item list
    Then the search bar should remain sticky at the top of the page

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Create a new item manually
    When I navigate to the New Item page
    And I enter the name "Almond Milk"
    And I enter the barcode "041570054529"
    And I enter the price "$3.99"
    And I select unit type "each"
    And I tap "Save"
    Then the item "Almond Milk" should be created in the database
    And the item should have barcode "041570054529"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Create a per-pound item
    When I navigate to the New Item page
    And I enter the name "Chicken Breast"
    And I enter the price "$6.99"
    And I select unit type "per_lb"
    And I tap "Save"
    Then the item "Chicken Breast" should be created with unit type "per_lb"

  # Commit: Improve barcode field UI to indicate PLU codes are accepted
  Scenario: PLU code is recognized in barcode field
    When I navigate to the New Item page
    And I enter "4011" in the barcode field
    Then I should see a hint indicating this is a PLU code
    And the field label should indicate "Barcode / PLU Code"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: View item detail with price history
    Given an item "Organic Bananas" exists with price history
    When I navigate to the Item Detail page for "Organic Bananas"
    Then I should see the current price
    And I should see the unit type
    And I should see a price history chart
    And I should see a link to the full price history report

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Edit an existing item
    Given an item "Almond Milk" exists with price "$3.99"
    When I navigate to the Item Detail page for "Almond Milk"
    And I tap "Edit"
    And I change the name to "Vanilla Almond Milk"
    And I tap "Save"
    Then the item name should be updated to "Vanilla Almond Milk"

  # Commit: Remove unused picture field from Item interface
  Scenario: Item does not have a picture field
    When I create a new item "Test Item"
    Then the item should not have a "picture" property
    And the item form should not show a picture upload field

  # Commit: Add grocery category autocomplete with typeahead search
  Scenario: Category autocomplete suggests existing categories
    Given items exist with categories "Produce", "Dairy", "Bakery"
    When I navigate to the New Item page
    And I start typing "Pro" in the category field
    Then I should see "Produce" as a suggestion
    When I select "Produce"
    Then the category field should be filled with "Produce"

  # Commit: Add grocery category autocomplete with typeahead search
  Scenario: Enter a custom category not in suggestions
    Given items exist with categories "Produce", "Dairy"
    When I navigate to the New Item page
    And I type "Frozen Foods" in the category field
    And I tap away from the field
    Then the category should be set to "Frozen Foods"
