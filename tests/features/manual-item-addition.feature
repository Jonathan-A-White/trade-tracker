Feature: Manual Item Addition
  As a grocery shopper
  I want to manually add items to my trip
  So that I can track items when scanning is not possible

  Background:
    Given the app is loaded
    And I have an active trip at "Trader Joe's"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Add an existing item manually
    Given an item "Bananas" exists with price "$0.29"
    When I tap "Add Manually" on the Active Trip page
    And I search for "Bananas"
    And I select "Bananas" from the results
    And I set the quantity to 6
    And I tap "Add to Trip"
    Then "Bananas" should be added to the trip with quantity 6
    And the line total should be "$1.74"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Create and add a new item during active trip
    When I tap "Add Manually" on the Active Trip page
    And I tap "Create New Item"
    And I fill in the item form with name "Sourdough Bread" and price "$4.49"
    And I tap "Save"
    Then "Sourdough Bread" should be created in the item library
    And "Sourdough Bread" should be added to the active trip

  # Commit: Fix add item hanging caused by Dexie transaction conflict
  Scenario: Adding item does not cause the app to hang
    Given an item "Bananas" exists
    When I tap "Add Manually" on the Active Trip page
    And I select "Bananas" from the results
    And I tap "Add to Trip"
    Then the item should be added without freezing or hanging
    And I should be returned to the Active Trip page

  # Commit: Fix "Adding..." button hang caused by nested Dexie transaction deadlock
  Scenario: Add button does not get stuck in "Adding..." state
    When I tap "Add Manually" on the Active Trip page
    And I search for an existing item
    And I select it and tap "Add to Trip"
    Then the button should not remain in "Adding..." state
    And the item should be added successfully

  # Commit: Fix Add Manually page rendering as inline content instead of overlay
  Scenario: Add Manually page renders as a full overlay
    When I tap "Add Manually" on the Active Trip page
    Then the Add Item page should render as a full overlay
    And it should not appear as inline content within the Active Trip page

  # Commit: Make Scan and Add Manually buttons sticky at top
  Scenario: Scan and Add Manually buttons stay visible while scrolling
    Given I have added many items to the trip
    When I scroll down through the item list
    Then the "Scan" and "Add Manually" buttons should remain sticky at the top
    And I can always access them without scrolling back up
