Feature: Trip Item Interactions
  As a grocery shopper
  I want to manage items within my active trip
  So that I can keep my item list accurate

  Background:
    Given the app is loaded
    And I have an active trip at "Trader Joe's"

  # Commit: Add delete/remove button for trip items
  Scenario: Remove an item from the active trip
    Given "Organic Milk" is in the active trip
    When I remove "Organic Milk" from the trip
    Then "Organic Milk" should no longer appear in the trip item list
    And the subtotal should be recalculated

  # Commit: Replace edit/remove buttons with swipe-to-delete and long-press-to-edit gestures
  Scenario: Swipe left to reveal delete button
    Given "Organic Milk" is in the active trip
    When I swipe left on the "Organic Milk" row
    Then a delete button should be revealed
    When I tap the delete button
    Then "Organic Milk" should be removed from the trip

  # Commit: Replace edit/remove buttons with swipe-to-delete and long-press-to-edit gestures
  Scenario: Swipe right to close revealed delete button
    Given "Organic Milk" is in the active trip
    And I have swiped left on the "Organic Milk" row to reveal the delete button
    When I swipe right on the "Organic Milk" row
    Then the delete button should be hidden

  # Commit: Replace edit/remove buttons with swipe-to-delete and long-press-to-edit gestures
  Scenario: Long press to show edit menu
    Given "Organic Milk" is in the active trip with price "$5.99" and quantity 2
    When I long-press on the "Organic Milk" row for 500ms
    Then an edit menu should appear near the item
    And the menu should show "Edit Price" and "Edit Quantity" options

  # Commit: Replace edit/remove buttons with swipe-to-delete and long-press-to-edit gestures
  Scenario: Edit item price via long-press menu
    Given "Organic Milk" is in the active trip with price "$5.99"
    When I long-press on "Organic Milk" and select "Edit Price"
    And I change the price to "$6.49"
    And I confirm the edit
    Then the price of "Organic Milk" should be updated to "$6.49"
    And the subtotal should be recalculated

  # Commit: Replace edit/remove buttons with swipe-to-delete and long-press-to-edit gestures
  Scenario: Edit item quantity via long-press menu
    Given "Organic Milk" is in the active trip with quantity 1
    When I long-press on "Organic Milk" and select "Edit Quantity"
    And I change the quantity to 3
    And I confirm the edit
    Then the quantity of "Organic Milk" should be updated to 3
    And the line total should reflect the new quantity

  # Commit: Fix hold-to-edit menu clipped by overflow-hidden container
  Scenario: Long-press edit menu is not clipped by container
    Given "Organic Milk" is the last item in the trip list
    When I long-press on "Organic Milk"
    Then the edit menu should be fully visible
    And the menu should not be clipped by the container's overflow
