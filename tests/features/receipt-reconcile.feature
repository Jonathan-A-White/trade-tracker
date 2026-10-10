Feature: Reconcile a trip from a photo of its receipt
  As a grocery shopper ending a trip
  I want to photograph the receipt and have the app fix each line's price and the total
  So that my prices, and the next trip's prices, match what the store charged

  Background:
    Given the app is loaded
    And I have an active trip at "Trader Joe's" with "Milk", "Bread" and "Eggs"
    And the factory is licensed
    And I am on the End Trip page

  Scenario: A receipt with two changed prices updates those two lines
    Given the receipt shows "Milk" at 4.29 and "Eggs" at 5.49 and a total of 14.78
    When I tap "Photograph receipt" and "Take photo" and "Done"
    And I tap "Send receipt"
    Then the page says it is waiting for the factory
    And the "Milk" and "Eggs" lines take the receipt's prices
    And the items' current prices and price history carry them
    And the Receipt Total is 14.78
    And "What changed" lists "Milk" and "Eggs" with their old and new prices
    And every item's barcode is unchanged

  Scenario: A receipt line with no trip line is listed as not matched
    Given the receipt shows a line "MYSTERY" that the factory could not match
    When I send the receipt photo
    Then I see "Not matched: 1"
    And no trip line changes for it

  Scenario: A refused receipt leaves the trip as it was
    Given the factory refuses the receipt saying "The photo is too dark."
    When I send the receipt photo
    Then I see "The photo is too dark."
    And every price is as it was
    And the Receipt Total is empty

  Scenario: A trip with too many lines for one request says how many it can take
    Given the trip has more lines than fit in one request to the factory
    When I send the receipt photo
    Then I see how many lines the factory can check, in words, with no byte count
    And nothing is sent and every price is as it was

  Scenario: A photo chosen from the gallery counts like a camera photo
    When I tap "Choose a photo" and pick a picture
    Then "1 photo ready" is shown

  Scenario: A long receipt takes up to three photos
    When I take three photos of the receipt
    Then "3 photos ready" is shown
    And I cannot add another photo

  Scenario: The factory is not licensed
    Given the factory is not licensed
    Then the Photograph receipt button is disabled
    And I am told to set the factory up under Settings

  Scenario: A new trip scanning a matched barcode gets the receipt's price
    Given a receipt reconcile changed "Milk" to 4.29
    When a new trip scans the barcode of "Milk"
    Then its line is priced 4.29
    And the price history of "Milk" carries 4.29

  Scenario: An unmatched receipt line can be matched to a trip line
    Given the receipt shows a line "ORG WHL WHT LOAF" at 4.49 that the factory could not match
    And no receipt line matched "Bread"
    When I send the receipt photo
    Then "Bread" is marked "Not on receipt"
    When I tap "Match to a line" and pick "Bread"
    Then the "Bread" line takes the price 4.49
    And "What changed" lists "Bread"
    And I see "Not matched: 0"
    And "Bread" is no longer marked "Not on receipt"

  Scenario: An unmatched receipt line can be added as a new item
    Given the receipt shows a line "TJ SNACK MIX" at 3.29 that the factory could not match
    When I send the receipt photo
    And I tap "Add as new item"
    Then the trip has a "TJ SNACK MIX" line priced 3.29
    And the new item has no barcode yet
    And I see "Not matched: 0"

  Scenario: Leaving End Trip and coming back shows the same lists
    Given I sent a receipt with one changed price and one unmatched line
    When I leave End Trip and open it again
    Then "What changed", "Not matched" and the Receipt Total are as I left them

  Scenario: A completed trip takes a receipt too
    Given I have a completed trip at "Trader Joe's" with "Milk" and "Bread" and no Receipt Total
    And the receipt shows "Milk" at 4.29 and "Bread" at 2.50 and a total of 6.79
    When I open the completed trip's page
    And I tap "Photograph receipt" and "Take photo" and "Done"
    And I tap "Send receipt"
    Then the "Milk" line takes the receipt's price
    And "What changed" lists "Milk" with its old and new price
    And I see "Not matched: 0"
    And the Receipt Total and the Actual Total are 6.79

  Scenario: A receipt line the factory could not match on a completed trip is handled as on End Trip
    Given the receipt shows a line "TJ SNACK MIX" at 3.29 that the factory could not match
    When I open the completed trip's page and send the receipt photo
    Then I see "Not matched: 1"
    When I tap "Add as new item"
    Then the trip has a "TJ SNACK MIX" line priced 3.29
    And I see "Not matched: 0"
