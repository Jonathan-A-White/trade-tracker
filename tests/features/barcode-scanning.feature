Feature: Barcode Scanning
  As a grocery shopper
  I want to scan barcodes during my shopping trip
  So that I can quickly add items and track prices

  Background:
    Given the app is loaded
    And I have an active trip at "Trader Joe's"

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Open barcode scanner during active trip
    When I tap "Scan" on the Active Trip page
    Then the scanner page opens with a full-screen viewfinder
    And the camera is activated for barcode detection

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Scan a known item barcode
    Given I have an item "Organic Milk" with barcode "012345678901" at "$4.99"
    When I scan barcode "012345678901"
    Then I see the item name "Organic Milk"
    And I see the current price "$4.99"
    And I see a quantity selector

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Add scanned item to trip
    Given I have scanned a known item "Organic Milk" at "$4.99"
    When I set the quantity to 2
    And I tap "Add to Trip"
    Then "Organic Milk" is added to the active trip with quantity 2
    And the trip subtotal increases by "$9.98"

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Scan an unknown barcode
    When I scan an unrecognized barcode "999999999999"
    Then I am redirected to the New Item page
    And the barcode field is pre-filled with "999999999999"
    And I can create the item and it will be added to the trip

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Scanner handles weight-based items
    Given I have a per-pound item "Chicken Breast" with barcode "567890123456"
    When I scan barcode "567890123456"
    Then I see a weight input field instead of a quantity selector
    When I enter weight "2.50"
    And I tap "Add to Trip"
    Then "Chicken Breast" is added with weight 2.50 lbs

  # From commit: Implement TradeTracker grocery tracking PWA
  Scenario: Camera permission denied
    Given the camera permission is denied
    When I tap "Scan" on the Active Trip page
    Then I see a permission denied message
    And I see an option to add items manually

  # From commit: Add barcode scanning to the New Item form
  Scenario: Scan barcode from New Item form
    When I navigate to the New Item page
    And I tap the scan button in the barcode field
    Then the barcode scanner opens inline
    When I scan barcode "012345678901"
    Then the barcode field is populated with "012345678901"
    And the scanner closes

  # From commit: Fix "Adding..." button hang caused by nested Dexie transaction deadlock
  Scenario: Adding scanned item does not hang
    Given I have scanned a known item
    When I tap "Add to Trip"
    Then the item is added without the button getting stuck on "Adding..."
    And I can immediately scan another item

  # From commit: Merge duplicate items by incrementing quantity
  Scenario: Scanning the same item twice merges quantities
    Given I have already added "Organic Milk" with quantity 1 to the trip
    When I scan the barcode for "Organic Milk" again
    And I set quantity to 1
    And I tap "Add to Trip"
    Then the existing "Organic Milk" entry is updated to quantity 2
    And no duplicate row is created

  # From commit: Merge duplicate items by incrementing quantity
  Scenario: Scanning the same per-pound item adds weight
    Given I have already added "Chicken Breast" with weight 1.5 lbs
    When I scan the barcode for "Chicken Breast" again
    And I enter weight "2.00"
    And I tap "Add to Trip"
    Then the existing "Chicken Breast" weight is updated to 3.50 lbs
