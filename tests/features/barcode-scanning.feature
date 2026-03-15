Feature: Barcode Scanning
  As a grocery shopper
  I want to scan product barcodes
  So that I can quickly add items to my trip

  Background:
    Given the app is loaded
    And I have an active trip at "Trader Joe's"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Scan a known barcode
    Given an item "Organic Milk" exists with barcode "036632001252"
    When I tap "Scan" on the Active Trip page
    And the scanner reads barcode "036632001252"
    Then I should see the item name "Organic Milk"
    And I should see the current price
    And I should see a quantity selector

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Add scanned item to trip
    Given an item "Organic Milk" exists with barcode "036632001252" and price "$5.99"
    When I tap "Scan" on the Active Trip page
    And the scanner reads barcode "036632001252"
    And I set the quantity to 1
    And I tap "Add to Trip"
    Then the item should be added to the active trip
    And the trip subtotal should increase by "$5.99"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Scan an unknown barcode
    When I tap "Scan" on the Active Trip page
    And the scanner reads barcode "999999999999"
    Then I should be redirected to the Add Item page
    And the barcode field should be pre-filled with "999999999999"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Scan a per-pound item
    Given a per-pound item "Chicken Breast" exists with barcode "021130099993" and price "$6.99"
    When I tap "Scan" on the Active Trip page
    And the scanner reads barcode "021130099993"
    Then I should see a weight input field instead of a quantity selector
    When I enter weight "2.5" lbs
    And I tap "Add to Trip"
    Then the line total should be "$17.48"

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Camera permission denied
    When I tap "Scan" on the Active Trip page
    And camera permission is denied
    Then I should see a permission denied message
    And I should see a fallback option for manual entry

  # Commit: Implement TradeTracker grocery tracking PWA
  Scenario: Camera not available
    When I tap "Scan" on the Active Trip page
    And the camera is not available
    Then I should see a message that camera is unavailable
    And I should see a fallback option for manual entry

  # Commit: Add barcode scanning to the New Item form
  Scenario: Scan barcode from the New Item form
    When I navigate to the New Item page
    And I tap the scan button next to the barcode field
    Then the barcode scanner should open
    When the scanner reads barcode "041570054529"
    Then the barcode field should be filled with "041570054529"
    And the scanner should close

  # Commit: Merge duplicate items by incrementing quantity
  Scenario: Scanning same item twice merges quantity
    Given an item "Organic Milk" exists with barcode "036632001252"
    And "Organic Milk" is already in the active trip with quantity 1
    When I scan barcode "036632001252" again
    And I add it to the trip
    Then the quantity of "Organic Milk" should be 2
    And no duplicate row should be created

  # Commit: Merge duplicate items by incrementing quantity
  Scenario: Scanning same per-pound item adds weight
    Given a per-pound item "Chicken Breast" exists with barcode "021130099993"
    And "Chicken Breast" is already in the trip with weight "1.5" lbs
    When I scan barcode "021130099993" again
    And I enter weight "2.0" lbs
    And I add it to the trip
    Then the total weight of "Chicken Breast" should be "3.5" lbs
