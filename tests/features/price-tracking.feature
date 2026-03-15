Feature: Price Tracking and History
  As a grocery shopper
  I want to track item prices over time
  So that I can identify trends and find the best deals

  Background:
    Given the app is loaded

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Price history is recorded when item is added to trip
    Given an item "Organic Milk" exists with price "$5.99"
    And I have an active trip at "Trader Joe's"
    When I add "Organic Milk" to the trip at "$5.99"
    Then a price history record should be created
    And the record should link to the item, store, and trip

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: View price history report for an item
    Given an item "Organic Milk" has the following price history:
      | Store          | Price | Date       |
      | Trader Joe's   | $5.49 | 2025-01-01 |
      | Trader Joe's   | $5.99 | 2025-02-01 |
      | Whole Foods    | $6.49 | 2025-02-15 |
    When I navigate to the Price History Report for "Organic Milk"
    Then I should see a line chart showing price trends
    And I should see the lowest price "$5.49"
    And I should see the highest price "$6.49"
    And I should see the average price
    And I should see the current price "$6.49"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Filter price history by store
    Given an item "Organic Milk" has prices at "Trader Joe's" and "Whole Foods"
    When I navigate to the Price History Report for "Organic Milk"
    And I filter by store "Trader Joe's"
    Then I should only see price records from "Trader Joe's"
    And the chart should only show "Trader Joe's" prices

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: View price chart on item detail page
    Given an item "Organic Milk" has price history
    When I navigate to the Item Detail page for "Organic Milk"
    Then I should see a compact price chart
    And I should see a link to the full price history report
