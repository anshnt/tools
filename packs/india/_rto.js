// Vehicle registration data: every state and union territory code, plus RTO codes for the larger states (compiled from the public
// state transport department lists and Wikipedia's RTO tables). The RTO lists are intentionally partial: unknown codes still show the
// state, and the tool links to the official Vahan service. Pure data and functions, no DOM.

const S = (code, name, kind = 'State', rtos = '', extra = {}) => ({ code, name, kind, rtos, ...extra })

export const STATES = [
  S('AN', 'Andaman and Nicobar Islands', 'Union Territory', '01=Port Blair'),
  S('AP', 'Andhra Pradesh', 'State', '02=Ananthapuramu|03=Chittoor|04=YSR Kadapa|05=Kakinada (East Godavari)|07=Guntur|16=Vijayawada (Krishna)|21=Kurnool|26=Nellore|27=Ongole (Prakasam)|30=Srikakulam|31=Visakhapatnam|35=Vizianagaram|37=Eluru (West Godavari)|39=Newer statewide series|40=Newer statewide series'),
  S('AR', 'Arunachal Pradesh', 'State', '01=Itanagar'),
  S('AS', 'Assam', 'State', '01=Guwahati|02=Nagaon|03=Jorhat|04=Sivasagar|05=Golaghat|06=Dibrugarh|07=North Lakhimpur|08=Haflong|09=Diphu (Karbi Anglong)|10=Karimganj|11=Silchar|12=Tezpur|13=Mangaldoi (Darrang)|14=Nalbari|15=Barpeta|16=Kokrajhar|17=Dhubri|18=Goalpara|19=Bongaigaon|21=Morigaon|22=Dhemaji|23=Tinsukia|24=Hailakandi|25=Kamrup|26=Kajalgaon|27=Udalguri|31=Hojai|32=Biswanath Chariali|33=Charaideo'),
  S('BR', 'Bihar', 'State', '01=Patna|02=Gaya|03=Arrah|04=Chhapra|05=Motihari|06=Muzaffarpur|07=Darbhanga|08=Munger|09=Begusarai|10=Bhagalpur|11=Purnia|19=Saharsa|21=Bihar Sharif|22=Bettiah|24=Dehri|25=Jehanabad|26=Aurangabad|27=Nawada|28=Gopalganj|29=Siwan|30=Sitamarhi|31=Hajipur|32=Madhubani|33=Samastipur|34=Khagaria|37=Kishanganj|38=Araria|39=Katihar|43=Madhepura|44=Buxar|45=Bhabua|46=Jamui|50=Supaul|51=Banka|52=Sheikhpura|53=Lakhisarai|55=Sheohar|56=Arwal'),
  S('CG', 'Chhattisgarh', 'State', '04=Raipur|05=Dhamtari|06=Mahasamund|07=Durg|08=Rajnandgaon|09=Kawardha|10=Bilaspur|11=Janjgir|12=Korba|13=Raigarh|14=Jashpur Nagar|15=Ambikapur|16=Baikunthpur|17=Jagdalpur|18=Dantewada|19=Kanker|20=Bijapur|21=Narayanpur|22=Baloda Bazar|23=Gariaband|24=Balod|25=Bemetara|26=Sukma|27=Kondagaon|28=Mungeli|29=Surajpur|30=Balrampur'),
  S('CH', 'Chandigarh', 'Union Territory', '01=Chandigarh|02=Chandigarh|03=Chandigarh|04=Chandigarh'),
  S('DD', 'Dadra and Nagar Haveli and Daman and Diu', 'Union Territory', '', { note: 'DD covers both after the 2020 merger. Older plates used DN (Dadra and Nagar Haveli) and DD (Daman and Diu).' }),
  S('DN', 'Dadra and Nagar Haveli', 'Union Territory', '', { legacy: true }),
  S('DL', 'Delhi', 'Union Territory', '1=Mall Road, North Delhi|2=Indraprastha Depot|3=Sheikh Sarai (South Delhi)|4=Janakpuri (West Delhi)|5=Loni Road, Shahdara|6=Sarai Kale Khan|7=Mayur Vihar (East Delhi)|8=Wazirpur|9=Dwarka|10=Raja Garden|11=Rohini|12=Vasant Vihar|13=Surajmal Vihar'),
  S('GA', 'Goa', 'State', '01=Panaji|02=Margao|03=Mapusa|04=Bicholim|05=Ponda|06=Vasco da Gama|07=Panaji|08=Margao|09=Quepem|10=Canacona|11=Pernem|12=Dharbandora'),
  S('GJ', 'Gujarat', 'State', '01=Ahmedabad (West)|02=Mehsana|03=Rajkot|04=Bhavnagar|05=Surat|06=Vadodara|07=Nadiad|08=Palanpur|09=Himmatnagar|10=Jamnagar|11=Junagadh|12=Bhuj (Kutch)|13=Surendranagar|14=Amreli|15=Valsad|16=Bharuch|17=Godhra|18=Gandhinagar|19=Bardoli|20=Dahod|21=Navsari|22=Rajpipla|23=Anand|24=Patan|25=Porbandar|26=Vyara|27=Ahmedabad (East)|30=Ahwa|31=Modasa|32=Veraval|33=Botad|34=Chhota Udaipur|35=Lunawada|36=Morbi|37=Khambhaliya|38=Bavla|39=Anjar|40=Tharad'),
  S('HP', 'Himachal Pradesh', 'State', '01=Statewide (tourist vehicles)|03=Shimla (Urban)|04=Kangra|05=Mandi|06=Rampur Bushahr|07=Shimla (Urban)|08=Chaupal|09=Theog|10=Rohru|11=Arki|12=Nalagarh|13=Kandaghat|14=Solan|15=Parwanoo|16=Rajgarh|17=Paonta Sahib|18=Nahan|19=Amb|20=Una|21=Barsar|22=Hamirpur|23=Ghumarwin|24=Bilaspur|25=Kalpa|28=Sarkaghat|29=Jogindernagar|30=Karsog|31=Sundernagar|34=Kullu|37=Palampur|38=Nurpur|39=Dharamshala'),
  S('HR', 'Haryana', 'State', '01=Ambala|02=Jagadhri|03=Panchkula|04=Naraingarh|05=Karnal|06=Panipat|07=Thanesar (Kurukshetra)|08=Kaithal|09=Guhla|10=Sonipat|11=Gohana|12=Rohtak|13=Bahadurgarh|14=Jhajjar|15=Meham|16=Bhiwani|17=Siwani|18=Loharu|19=Charkhi Dadri|20=Hisar|21=Hansi|22=Fatehabad|23=Tohana|24=Sirsa|25=Mandi Dabwali|26=Gurugram (North)|27=Nuh|28=Ferozepur Jhirka|29=Ballabgarh|30=Palwal|31=Jind|32=Narwana|33=Safidon|34=Mahendragarh|35=Narnaul|36=Rewari|37=Ambala|38=Faridabad|39=Hisar|40=Assandh|41=Pehowa|42=Ganaur|43=Kosli|44=Ellenabad|45=Karnal'),
  S('JH', 'Jharkhand', 'State', '01=Ranchi|02=Hazaribagh|03=Daltonganj|04=Dumka|05=Jamshedpur|06=Chaibasa|07=Gumla|08=Lohardaga|09=Bokaro|10=Dhanbad|11=Giridih|12=Koderma|13=Chatra|14=Garhwa|15=Deoghar|16=Pakur|17=Godda|18=Sahibganj|19=Latehar|20=Simdega|21=Jamtara|22=Seraikela Kharsawan|23=Khunti|24=Ramgarh'),
  S('JK', 'Jammu and Kashmir', 'Union Territory', '01=Srinagar|02=Jammu'),
  S('KA', 'Karnataka', 'State', '01=Bengaluru Central (Koramangala, HSR Layout)|02=Bengaluru West (Rajajinagar)|03=Bengaluru East (Indiranagar)|04=Bengaluru North (Yeshwanthpur)|05=Bengaluru South (Jayanagar)|06=Tumakuru|07=Kolar|08=Kolar Gold Fields|09=Mysuru West|10=Chamarajanagar|11=Mandya|12=Madikeri|13=Hassan|14=Shivamogga|15=Sagara|16=Chitradurga|17=Davanagere|18=Chikkamagaluru|19=Mangaluru|20=Udupi|21=Puttur|22=Belagavi|23=Chikkodi|24=Bailhongal|25=Dharwad|26=Gadag|27=Haveri|28=Vijayapura|29=Bagalkote|30=Karwar|31=Sirsi|32=Kalaburagi|33=Yadgir|34=Ballari|35=Hosapete|36=Raichur|37=Koppal|38=Bidar|39=Bhalki|40=Chikkaballapura|41=Jnana Bharathi (Bengaluru)|42=Ramanagara|43=Devanahalli|44=Tiptur|45=Hunsur|46=Sakleshpura|47=Honnavar|48=Jamkhandi|49=Gokak|50=Yelahanka (Bengaluru)|51=Electronic City (Bengaluru)|52=Nelamangala|53=Krishnarajapuram (Bengaluru)|54=Nagamangala|55=Mysuru East|56=Basavakalyan|57=Shantinagara (Bengaluru)|59=Chandapura|63=Dharwad East|64=Madhugiri|65=Dandeli|66=Tarikere|67=Chintamani|68=Ranebennur|69=Ramdurg|70=Bantwal|71=Athani'),
  S('KL', 'Kerala', 'State', '01=Thiruvananthapuram|02=Kollam|03=Pathanamthitta|04=Alappuzha|05=Kottayam|06=Idukki|07=Ernakulam (Kochi)|08=Thrissur|09=Palakkad|10=Malappuram|11=Kozhikode|12=Wayanad (Kalpetta)|13=Kannur|14=Kasaragod|15=Thiruvananthapuram (KSRTC)|16=Attingal|17=Muvattupuzha|18=Vadakara|19=Parassala|20=Neyyattinkara|21=Nedumangad|22=Kazhakkoottam|23=Karunagappalli|24=Kottarakkara|25=Punalur|26=Adoor|27=Tiruvalla|28=Mallappally|29=Kayamkulam|30=Chengannur|31=Mavelikkara|32=Cherthala|33=Changanassery|34=Kanjirappally|35=Pala|36=Vaikom|37=Vandiperiyar|38=Thodupuzha|39=Thripunithura|40=Perumbavoor|41=Aluva|42=North Paravur|43=Fort Kochi|44=Kothamangalam|45=Irinjalakuda|46=Guruvayur|47=Kodungallur|48=Wadakkancherry|49=Alathur|50=Mannarkkad|51=Ottapalam|52=Pattambi|53=Perinthalmanna|54=Ponnani|55=Tirur|56=Koyilandy|57=Koduvally|58=Thalassery|59=Taliparamba|60=Kanhangad|61=Kunnathur|62=Ranni|63=Angamaly|64=Chalakkudy|65=Tirurangadi|66=Kuttanad|67=Uzhavoor|68=Devikulam|69=Udumbanchola|70=Chittur|71=Nilambur|72=Mananthavady|73=Sulthan Bathery|74=Kattakada|75=Thriprayar|76=Nanmanda|77=Perambra|78=Iritty|79=Vellarikundu|80=Pathanapuram|81=Varkala|82=Chadayamangalam|83=Konni|84=Kondotty|85=Ramanattukara-Feroke|86=Payyannur'),
  S('LA', 'Ladakh', 'Union Territory', '01=Leh|02=Kargil'),
  S('LD', 'Lakshadweep', 'Union Territory', '01=Kavaratti'),
  S('MH', 'Maharashtra', 'State', '01=Mumbai Central (Tardeo)|02=Mumbai West (Andheri)|03=Mumbai East (Wadala)|04=Thane|05=Kalyan|06=Raigad (Pen)|07=Sindhudurg (Kudal)|08=Ratnagiri|09=Kolhapur|10=Sangli|11=Satara|12=Pune|13=Solapur|14=Pimpri-Chinchwad|15=Nashik|16=Ahilyanagar (Ahmednagar)|17=Shrirampur|18=Dhule|19=Jalgaon|20=Chhatrapati Sambhajinagar (Aurangabad)|21=Jalna|22=Parbhani|23=Beed|24=Latur|25=Dharashiv (Osmanabad)|26=Nanded|27=Amravati|28=Buldhana|29=Yavatmal|30=Akola|31=Nagpur (City)|32=Wardha|33=Gadchiroli|34=Chandrapur|35=Gondia|36=Bhandara|37=Washim|38=Hingoli|39=Nandurbar|40=Nagpur (Rural)|41=Malegaon|42=Baramati|43=Navi Mumbai (Vashi)|44=Ambajogai|45=Akluj|46=Panvel|47=Mumbai North (Borivali)|48=Vasai|49=Nagpur (East)|50=Karad|51=Ichalkaranji|52=Chalisgaon|53=Phaltan|54=Bhadgaon|55=Udgir|56=Khamgaon|57=Vaijapur|58=Mira-Bhayandar|59=Jat|60=Palghar|61=Pune'),
  S('ML', 'Meghalaya', 'State', '01=Shillong'),
  S('MN', 'Manipur', 'State', '01=Imphal'),
  S('MP', 'Madhya Pradesh', 'State', '01=Bhopal|02=Bhopal|03=Bhopal|04=Bhopal|05=Hoshangabad (Narmadapuram)|06=Morena|07=Gwalior|08=Guna|09=Indore|10=Khargone|11=Dhar|12=Khandwa|13=Ujjain|14=Mandsaur|15=Sagar|16=Chhatarpur|17=Rewa|18=Shahdol|19=Satna|20=Jabalpur|21=Katni|22=Seoni|28=Chhindwara|30=Bhind|31=Sheopur|32=Datia|33=Shivpuri|34=Damoh|35=Panna|36=Tikamgarh|37=Sehore|38=Raisen|39=Rajgarh|40=Vidisha|41=Dewas|42=Shajapur|43=Ratlam|44=Neemuch|45=Jhabua|46=Barwani|47=Harda|48=Betul|49=Narsinghpur|50=Balaghat|51=Mandla|52=Dindori|53=Sidhi|54=Umaria|65=Anuppur|66=Singrauli|67=Ashoknagar|68=Burhanpur|69=Alirajpur|70=Agar Malwa|71=Niwari'),
  S('MZ', 'Mizoram', 'State', '01=Aizawl'),
  S('NL', 'Nagaland', 'State', '01=Kohima|07=Dimapur'),
  S('OD', 'Odisha', 'State', '02=Bhubaneswar|05=Cuttack', { note: 'OD replaced the older OR series in 2012.' }),
  S('OR', 'Odisha', 'State', '', { legacy: true }),
  S('PB', 'Punjab', 'State', '01=Chandigarh (Punjab)|02=Amritsar|03=Bathinda|04=Faridkot|05=Ferozepur|06=Gurdaspur|07=Hoshiarpur|08=Jalandhar|09=Kapurthala|10=Ludhiana (West)|11=Patiala|12=Rupnagar|13=Sangrur|14=Ajnala|15=Abohar|16=Anandpur Sahib|17=Baba Bakala|18=Batala|19=Barnala|20=Balachaur|21=Dasuya|22=Fazilka|23=Fatehgarh Sahib|24=Garhshankar|25=Jagraon|26=Khanna|27=Kharar|28=Malerkotla|29=Moga|30=Muktsar|31=Mansa|32=Nawanshahar|33=Nakodar|34=Nabha|35=Pathankot|36=Phagwara|37=Phillaur|38=Patti|39=Rajpura|40=Rampura Phul|41=Sultanpur Lodhi|42=Samana|43=Samrala|44=Sunam|45=Talwandi Sabo|46=Tarn Taran|47=Zira|65=Mohali (SAS Nagar)|89=Amritsar|90=Jalandhar|91=Ludhiana (East)'),
  S('PY', 'Puducherry', 'Union Territory', '01=Puducherry|02=Karaikal|03=Mahe|04=Yanam'),
  S('RJ', 'Rajasthan', 'State', '01=Ajmer|02=Alwar|03=Banswara|04=Barmer|05=Bharatpur|06=Bhilwara|07=Bikaner|08=Bundi|09=Chittorgarh|10=Churu|11=Dholpur|12=Dungarpur|13=Sri Ganganagar|14=Jaipur (South)|15=Jaisalmer|16=Jalore|17=Jhalawar|18=Jhunjhunu|19=Jodhpur|20=Kota|21=Nagaur|22=Pali|23=Sikar|24=Sirohi|25=Sawai Madhopur|26=Tonk|27=Udaipur|28=Baran|29=Dausa|30=Rajsamand|31=Hanumangarh|32=Kotputli|33=Ramganj Mandi|34=Karauli|35=Pratapgarh|36=Beawar|37=Didwana|38=Abu Road|39=Balotra|40=Bhiwadi|41=Chomu|42=Kishangarh|43=Phalodi|44=Sujangarh|45=Jaipur|46=Bhinmal|47=Dudu|48=Kekri|49=Nohar|50=Nokha|51=Shahpura|53=Khetri|54=Piparcity|55=Pokhran|56=Sadulshahar|57=Sumerpur|58=Salumbar|60=Jaipur'),
  S('SK', 'Sikkim', 'State', '01=Gangtok'),
  S('TN', 'Tamil Nadu', 'State', '01=Chennai (Central)|02=Chennai (North West)|03=Chennai (North East)|04=Chennai (East)|05=Chennai (North)|06=Chennai (South East)|07=Chennai (South)|09=Chennai (West)|10=Chennai (South West)|11=Tambaram|12=Poonamallee|13=Ambattur|14=Sholinganallur|15=Ulundurpet|16=Tindivanam|18=Red Hills|19=Chengalpattu|20=Tiruvallur|21=Kanchipuram|22=Meenambakkam|23=Vellore|24=Krishnagiri|25=Thiruvannamalai|27=Salem|28=Namakkal|29=Dharmapuri|30=Salem|31=Cuddalore|32=Villupuram|33=Erode|34=Tiruchengode|36=Gobichettipalayam|37=Coimbatore|38=Coimbatore|39=Tirupur|40=Mettupalayam|41=Pollachi|42=Tirupur|43=Ooty (Nilgiris)|45=Tiruchirappalli|46=Perambalur|47=Karur|48=Srirangam|49=Thanjavur|50=Tiruvarur|51=Nagapattinam|55=Pudukkottai|57=Dindigul|58=Madurai (South)|59=Madurai (North)|60=Theni|63=Sivagangai|65=Ramanathapuram|67=Virudhunagar|69=Thoothukudi|72=Tirunelveli|74=Nagercoil'),
  S('TG', 'Telangana', 'State', '01=Adilabad|02=Karimnagar|03=Warangal|04=Khammam|05=Nalgonda|06=Mahbubnagar|07=Attapur (Hyderabad)|08=Medchal|09=Khairtabad (Hyderabad)|10=Secunderabad|11=Malakpet (Hyderabad)|12=Kishanbagh (Hyderabad)|13=Tolichowki (Hyderabad)|14=Hyderabad|15=Sangareddy|16=Nizamabad|17=Kamareddy|18=Nirmal|19=Mancherial|20=Asifabad|21=Jagtial|22=Peddapalli|23=Sircilla|24=Warangal|25=Bhupalpalle|26=Mahabubabad|27=Jangaon|28=Kothagudem|29=Suryapet|30=Bhuvanagiri|31=Nagarkurnool|32=Wanaparthy|33=Gadwal|34=Vikarabad|35=Medak|36=Siddipet|37=Mulugu|38=Narayanpet', { note: 'TG is the newer Telangana series (from 2024). Older plates use TS.' }),
  S('TR', 'Tripura', 'State', '01=Agartala'),
  S('TS', 'Telangana', 'State', '01=Adilabad|02=Karimnagar|03=Warangal|04=Khammam|05=Nalgonda|06=Mahbubnagar|07=Attapur (Hyderabad)|08=Medchal|09=Khairtabad (Hyderabad)|10=Secunderabad|11=Malakpet (Hyderabad)|12=Kishanbagh (Hyderabad)|13=Tolichowki (Hyderabad)|14=Hyderabad|15=Sangareddy|16=Nizamabad|17=Kamareddy|18=Nirmal|19=Mancherial|20=Asifabad|21=Jagtial|22=Peddapalli|23=Sircilla|24=Warangal|25=Bhupalpalle|26=Mahabubabad|27=Jangaon|28=Kothagudem|29=Suryapet|30=Bhuvanagiri|31=Nagarkurnool|32=Wanaparthy|33=Gadwal|34=Vikarabad|35=Medak|36=Siddipet|37=Mulugu|38=Narayanpet', { note: 'TS was the Telangana series until 2024, when TG replaced it.' }),
  S('UA', 'Uttarakhand', 'State', '', { legacy: true }),
  S('UK', 'Uttarakhand', 'State', '01=Almora|02=Bageshwar|03=Champawat|04=Haldwani (Nainital)|05=Pithoragarh|06=Rudrapur (Udham Singh Nagar)|07=Dehradun|08=Haridwar|09=Tehri|10=Uttarkashi|11=Gopeshwar (Chamoli)|12=Pauri|13=Rudraprayag|14=Rishikesh|15=Kotdwar|16=Vikasnagar|17=Roorkee|18=Kashipur|19=Ramnagar|20=Ranikhet'),
  S('UP', 'Uttar Pradesh', 'State', '11=Saharanpur|12=Muzaffarnagar|13=Bulandshahr|14=Ghaziabad|15=Meerut|16=Noida (Gautam Buddh Nagar)|17=Baghpat|19=Shamli|20=Bijnor|21=Moradabad|22=Rampur|23=Amroha|24=Badaun|25=Bareilly|26=Pilibhit|27=Shahjahanpur|30=Hardoi|31=Lakhimpur Kheri|32=Lucknow|33=Raebareli|34=Sitapur|35=Unnao|36=Amethi|37=Hapur|38=Bahjoi|40=Bahraich|41=Barabanki|42=Ayodhya|43=Gonda|44=Sultanpur|45=Akbarpur|46=Shravasti|47=Balrampur|50=Azamgarh|51=Basti|52=Deoria|53=Gorakhpur|54=Mau|55=Siddharthnagar|56=Maharajganj|57=Padrauna (Kushinagar)|58=Khalilabad|60=Ballia|61=Ghazipur|62=Jaunpur|63=Mirzapur|64=Robertsganj|65=Varanasi|66=Gyanpur|67=Chandauli|70=Prayagraj|71=Fatehpur|72=Pratapgarh|73=Manjhanpur|74=Kannauj|75=Etawah|76=Farrukhabad|77=Akbarpur (Kanpur Dehat)|78=Kanpur', { note: 'UP 80 (Agra) and other newer series codes are not in this list.' }),
  S('WB', 'West Bengal', 'State', '01=Kolkata (Beltala)|02=Kolkata (Beltala)|03=Kolkata (Beltala)|04=Kolkata (Beltala)|05=Kolkata (Kasba)|06=Kolkata (Kasba)|07=Salt Lake|08=Salt Lake|09=Behala|10=Behala|11=Howrah|12=Howrah|13=Uluberia|14=Uluberia|15=Chinsurah|16=Chinsurah|17=Serampore|18=Serampore|19=Alipore|20=Alipore|21=Basirhat|22=Basirhat|23=Barrackpore|24=Barrackpore|25=Barasat|26=Barasat|27=Bangaon|28=Bangaon|29=Tamluk|30=Tamluk|31=Contai|32=Contai|33=Medinipur|34=Medinipur|35=Kharagpur|36=Kharagpur|37=Asansol|38=Asansol|39=Durgapur|40=Durgapur|41=Bardhaman|42=Bardhaman|43=Kalna|44=Kalna|45=Rampurhat|46=Rampurhat|47=Bolpur|48=Bolpur|49=Jhargram|50=Jhargram|51=Krishnanagar|52=Krishnanagar|53=Birbhum|54=Birbhum|55=Purulia|56=Purulia|57=Murshidabad|58=Murshidabad|59=Raiganj|60=Raiganj'),
]

const byCode = new Map(STATES.map((s) => [s.code, s]))
const parsed = new Map()
/** Map of RTO number -> office for a state (numbers compared without leading zeros). */
function rtoMap(st) {
  if (!parsed.has(st.code)) {
    const m = new Map()
    for (const part of st.rtos ? st.rtos.split('|') : []) {
      const i = part.indexOf('=')
      m.set(String(Number(part.slice(0, i))), part.slice(i + 1))
    }
    parsed.set(st.code, m)
  }
  return parsed.get(st.code)
}

export const stateByCode = (code) => byCode.get(String(code).toUpperCase()) || null
export const rtoOffice = (stateCode, rto) => {
  const st = stateByCode(stateCode)
  return st ? rtoMap(st).get(String(Number(rto))) || null : null
}
/** [{rto: '01', office}] for a state. */
export const rtosOf = (code) => {
  const st = stateByCode(code)
  return st ? [...rtoMap(st)].map(([n, office]) => ({ rto: String(n).padStart(code === 'DL' ? 1 : 2, '0'), office })) : []
}

/**
 * Decode a plate: normal (MH12AB1234) or Bharat series (22BH1234AA).
 * -> {kind: 'bh'|'standard', state, rto, office, series, number, year?} | {error}
 */
export function parsePlate(input) {
  const s = String(input).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!s) return { error: 'empty' }
  const bh = s.match(/^(\d{2})BH(\d{4})([A-Z]{2})$/)
  if (bh) {
    if (/[IO]/.test(bh[3])) return { error: 'BH series letters never use I or O' }
    return { kind: 'bh', year: 2000 + Number(bh[1]), number: bh[2], series: bh[3], plate: `${bh[1]} BH ${bh[2]} ${bh[3]}` }
  }
  const m = s.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/)
  if (!m) return { error: 'Enter a plate like MH12AB1234, DL1CAB1234 or 22BH1234AA' }
  const st = stateByCode(m[1])
  if (!st) return { error: `"${m[1]}" is not a state or union territory code` }
  return { kind: 'standard', state: st, rto: m[2], office: rtoOffice(m[1], m[2]), series: m[3], number: m[4], plate: `${m[1]} ${m[2].padStart(2, '0')} ${m[3]} ${m[4].padStart(4, '0')}`.replace(/\s+/g, ' ') }
}
