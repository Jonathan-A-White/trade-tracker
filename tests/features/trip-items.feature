Feature: Trip Item Management
  As a grocery shopper
  I want to manage items within an active trip
  So that I can maintain an accurate shopping list

  Background:
    Given the app is loaded
    And I have an active trip at "Trader Joe's"

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Add an item manually during a trip
    When I tap "Add Manually" on the Active Trip page
    Then I see the Add Item page
    And I can search for existing items
    When I search for "Bananas"
    And I select "Bananas" from the results
    And I set the quantity to 1
    And I tap "Add"
    Then "Bananas" is added to the active trip

  # From commit: Fix add item hanging caused by Dexie transaction conflict
  Scenario: Add item manually without hanging
    When I tap "Add Manually"
    And I select an existing item
    And I tap "Add"
    Then the item is added without the UI freezing
    And I am returned to the Active Trip page

  # From commit: Fix remaining tripRepo reference in handleCreateNewItem
  Scenario: Create and add a new item during a trip
    When I tap "Add Manually"
    And I tap "Create New Item"
    And I fill in the new item form
    And I tap "Save"
    Then the new item is created in the item library
    And the new item is added to the active trip

  # From commit: Make Scan and Add Manually buttons sticky at top
  Scenario: Action buttons remain accessible while scrolling
    Given I have 20 items in the active trip
    When I scroll down through the item list
    Then the "Scan" and "Add Manually" buttons remain sticky at the top
    And they are always tappable

  # From commit: Add delete/remove button for trip items
  Scenario: Remove an item from the active trip
    Given I have "Bananas" in the active trip
    When I delete "Bananas" from the trip
    Then "Bananas" is removed from the trip item list
    And the subtotal is recalculated without "Bananas"

  # From commit: Replace edit/remove buttons with swipe-to-delete and long-press-to-edit
  Scenario: Swipe left to reveal delete button
    Given I have "Bananas" in the active trip
    When I swipe left on the "Bananas" row by at least 80 pixels
    Then a delete button is revealed on the right side
    When I tap the delete button
    Then "Bananas" is removed from the trip

  # From commit: Replace edit/remove buttons with swipe-to-delete and long-press-to-edit
  Scenario: Swipe right to dismiss delete button
    Given I have swiped left on the "Bananas" row to reveal the delete button
    When I swipe right on the row
    Then the delete button is hidden
    And the row returns to its normal position

  # From commit: Replace edit/remove buttons with swipe-to-delete and long-press-to-edit
  Scenario: Long press to edit item
    Given I have "Bananas" at "$0.69" in the active trip
    When I long press on the "Bananas" row for 500ms
    Then an edit menu appears near the item
    And I see options for "Edit Price" and "Edit Quantity"
    When I tap "Edit Price"
    Then I can modify the price inline

  # From commit: Fix hold-to-edit menu clipped by overflow-hidden container
  Scenario: Long press edit menu is not clipped by container
    Given I have many items in the active trip
    And "Milk" is near the bottom of the visible area
    When I long press on "Milk"
    Then the edit menu appears fully visible
    And the menu is not clipped by the scroll container

  # From commit: Replace edit/remove buttons with swipe-to-delete and long-press-to-edit
  Scenario: Long press is cancelled by swipe
    Given I start a long press on a trip item row
    When I move my finger horizontally before 500ms
    Then the long press is cancelled
    And no edit menu appears

  # From commit: Fix Add Manually page rendering as inline content instead of overlay
  Scenario: Add Manually renders as overlay not inline
    When I tap "Add Manually" on the Active Trip page
    Then the Add Item page renders as a full overlay
    And it does not appear as inline content within the trip page
