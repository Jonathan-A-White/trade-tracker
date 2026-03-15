Feature: Trip Management
  As a grocery shopper
  I want to manage shopping trips
  So that I can track my spending at different stores

  Background:
    Given the app is loaded
    And a store "Trader Joe's" exists

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Start a new shopping trip
    Given I am on the Home page
    When I tap "Start Trip"
    And I select the store "Trader Joe's"
    And I tap "Start Shopping"
    Then a new trip is created with status "active"
    And I am navigated to the Active Trip page
    And I see the store name "Trader Joe's" in the trip header

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View active trip with elapsed time
    Given I have an active trip at "Trader Joe's"
    When I navigate to the Active Trip page
    Then I see the elapsed time counter running
    And I see the scanned subtotal as "$0.00"

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: End a trip with receipt total
    Given I have an active trip at "Trader Joe's"
    And the scanned subtotal is "$25.47"
    When I tap "End Trip"
    And I enter the receipt total as "$26.00"
    Then I see the difference displayed as "$0.53"
    And the difference is color-coded green for under $1
    When I tap "Save Trip"
    Then the trip status changes to "completed"
    And the trip is saved with actual total "$26.00"

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: End trip difference color coding - slight variance
    Given I have an active trip with scanned subtotal "$25.00"
    When I end the trip with receipt total "$28.00"
    Then the difference "$3.00" is color-coded yellow

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: End trip difference color coding - large discrepancy
    Given I have an active trip with scanned subtotal "$25.00"
    When I end the trip with receipt total "$32.00"
    Then the difference "$7.00" is color-coded red

  # From commit: Fix end trip saving hang caused by Dexie transaction conflict
  Scenario: End trip saves without hanging
    Given I have an active trip with items
    When I tap "End Trip"
    And I enter the receipt total
    And I tap "Save Trip"
    Then the trip is saved successfully without freezing
    And I am navigated away from the End Trip page

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View trip history
    Given I have completed trips at "Trader Joe's" and "Costco"
    When I navigate to the Trip History page
    Then I see a list of all completed trips
    And each trip card shows the store name, date, and total

  # From commit: Make trip search card sticky at top of Trip History page
  Scenario: Trip history search card stays sticky while scrolling
    Given I have many completed trips
    When I navigate to the Trip History page
    And I scroll down through the trip list
    Then the search and filter card remains fixed at the top of the page

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: View trip detail
    Given I have a completed trip at "Trader Joe's" with 3 items
    When I tap on the trip card in Trip History
    Then I see the trip detail page
    And I see the date and time of the trip
    And I see the scanned subtotal and actual total
    And I see the difference with color coding
    And I see the list of all 3 items with prices and quantities

  # From commit: Fix View All 404 and add trip deletion
  Scenario: Delete a trip from trip detail
    Given I have a completed trip at "Trader Joe's"
    When I navigate to the Trip Detail page
    And I tap the delete button
    Then I see a confirmation dialog
    When I confirm deletion
    Then the trip is removed from the database
    And I am navigated back to the Trip History page

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Edit a completed trip
    Given I have a completed trip with item "Bananas" at "$0.69"
    When I navigate to the Trip Edit page
    And I change the price of "Bananas" to "$0.79"
    And I tap "Save Changes"
    Then the item price is updated to "$0.79"
    And the trip subtotal is recalculated

  # From commit: Fix store click providing no visual feedback on Start Trip page
  Scenario: Store selector provides visual feedback on selection
    Given I am on the New Trip page
    When I tap on a store card
    Then the selected store card is visually highlighted
    And the "Start Shopping" button becomes enabled

  # From commit: Add trip budget tracking with remaining balance display
  Scenario: Start a trip with a budget
    Given I am on the New Trip page
    When I select the store "Trader Joe's"
    And I enter a budget of "$100.00"
    And I tap "Start Shopping"
    Then the active trip is created with a budget of "$100.00"
    And the budget is displayed on the Active Trip page

  # From commit: Add trip budget tracking with remaining balance display
  Scenario: View remaining budget during active trip
    Given I have an active trip with a budget of "$100.00"
    And the scanned subtotal is "$35.50"
    When I view the Active Trip page
    Then I see the remaining budget as "$64.50"

  # From commit: Add trip budget tracking with remaining balance display
  Scenario: Edit budget during active trip
    Given I have an active trip with a budget of "$100.00"
    When I tap the budget display
    Then I see a budget edit modal
    When I change the budget to "$150.00"
    And I tap "Save"
    Then the budget is updated to "$150.00"
