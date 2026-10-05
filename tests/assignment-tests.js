(async function () {
  const T = RecommendationSDK._test,
    r = [];
  function a(n, c) {
    r.push([n, c]);
  }
  let h = await T.sha256("recommendation_test_2026:123456");
  a(
    "same input same hash",
    h === (await T.sha256("recommendation_test_2026:123456")),
  );
  a("bucket 0-99", T.bucket(h) >= 0 && T.bucket(h) <= 99);
  a(
    "target match",
    T.targetMatches(
      { portal: "detikcom" },
      { portal: "detikcom", section: "news" },
    ),
  );
  a(
    "target mismatch",
    !T.targetMatches({ portal: "detikcom" }, { portal: "other" }),
  );
  a(
    "50/50 bucket49 A",
    T.select(
      [
        { name: "A", percentage: 50 },
        { name: "B", percentage: 50 },
      ],
      49,
    ).name === "A",
  );
  a(
    "50/50 bucket50 B",
    T.select(
      [
        { name: "A", percentage: 50 },
        { name: "B", percentage: 50 },
      ],
      50,
    ).name === "B",
  );
  a(
    "conflict detection",
    T.findConflicts([
      { id: "A", recommendations: { x: { type: "experiment" } } },
      { id: "B", recommendations: { x: { type: "experiment" } } },
    ]).length === 1,
  );
  document.getElementById("out").innerHTML = r
    .map(
      (x) =>
        "<tr><td>" +
        x[0] +
        "</td><td class='" +
        (x[1] ? "p" : "f") +
        "'>" +
        (x[1] ? "PASS" : "FAIL") +
        "</td></tr>",
    )
    .join("");
  document.getElementById("sum").textContent =
    r.filter((x) => x[1]).length + "/" + r.length + " passed";
})();
