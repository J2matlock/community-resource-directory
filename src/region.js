// Everything specific to this community, in one place. To run the directory
// for another area, change this file, then run `npm run apply-region` to
// update the crisis bar, site name and help line on every page.

export const REGION = {
  siteName: 'Southern ADK Help',
  shortName: 'ADK Help', // under the home-screen icon (12 characters or fewer)
  domain: 'southernadkhelp.org',
  tagline: 'Free and low-cost help in Warren, Washington and Saratoga Counties, NY',

  // Counties people can filter by. "Regional" (serves everywhere) is added automatically.
  counties: ['Warren', 'Washington', 'Saratoga'],

  // Town → county, so the import and admin forms can fill in the county from an address.
  townCounty: {
    'Glens Falls': 'Warren', Queensbury: 'Warren', 'Lake George': 'Warren', Warrensburg: 'Warren',
    Bolton: 'Warren', Chestertown: 'Warren', 'Lake Luzerne': 'Warren', 'Diamond Point': 'Warren',
    'North Creek': 'Warren', 'Brant Lake': 'Warren',
    'Hudson Falls': 'Washington', 'Fort Edward': 'Washington', Cambridge: 'Washington',
    Granville: 'Washington', Greenwich: 'Washington', Salem: 'Washington', Whitehall: 'Washington',
    'Fort Ann': 'Washington', Argyle: 'Washington', Kingsbury: 'Washington',
    'Saratoga Springs': 'Saratoga', 'Ballston Spa': 'Saratoga', Malta: 'Saratoga',
    Gansevoort: 'Saratoga', 'South Glens Falls': 'Saratoga', Moreau: 'Saratoga',
    'Clifton Park': 'Saratoga', Mechanicville: 'Saratoga', Corinth: 'Saratoga', Wilton: 'Saratoga',
    Halfmoon: 'Saratoga', Schuylerville: 'Saratoga', Stillwater: 'Saratoga', Waterford: 'Saratoga',
    'Greenfield Center': 'Saratoga', 'Rock City Falls': 'Saratoga',
    'Burnt Hills': 'Saratoga', 'Ballston Lake': 'Saratoga', Rexford: 'Saratoga', Galway: 'Saratoga', Victory: 'Saratoga',
  },

  // Nearby cities outside the area. Listings there get an "Outside the area" note.
  outOfAreaTowns: ['Albany', 'Schenectady', 'Rotterdam', 'Troy', 'Plattsburgh'],
  outOfAreaNote: 'Outside Warren, Washington and Saratoga Counties',

  // The help line shown when someone can't find what they need.
  fallback: { phone: '211', webLabel: '211neny.org', webUrl: 'https://www.211neny.org/' },

  // The red crisis bar on every page. `wide: true` items show on computers only.
  crisis: [
    {
      title: 'In crisis?',
      items: [
        { href: 'tel:988', number: '988', label: 'Call' },
        { href: 'sms:988', number: '988', label: 'Text' },
        { href: 'https://988lifeline.org/chat/', number: '988', label: 'Chat online', wide: true },
        { href: 'tel:911', number: '911', label: 'Emergency' },
        { note: 'Can\'t call from this computer? Dial 911 from any phone.', wide: true },
      ],
    },
    {
      title: 'Domestic violence, 24 hours:',
      items: [
        { href: 'tel:+15187939496', number: '(518) 793-9496', label: 'Warren & Washington', srPrefix: 'Domestic violence hotline, ' },
        { href: 'tel:+15185848188', number: '(518) 584-8188', label: 'Saratoga', srPrefix: 'Domestic violence hotline, ' },
      ],
    },
  ],
};
