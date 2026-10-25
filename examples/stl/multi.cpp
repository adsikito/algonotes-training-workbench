#include <iostream>
#include <map>
#include <set>
#include <string>
int main(){
 std::multimap<int,std::string> m;
 m.insert(std::make_pair(2,"b"));m.insert(std::make_pair(2,"c"));m.insert(std::make_pair(1,"a"));
 std::pair<std::multimap<int,std::string>::iterator,std::multimap<int,std::string>::iterator> range=m.equal_range(2);
 int count=0;for(std::multimap<int,std::string>::iterator it=range.first;it!=range.second;++it)++count;
 std::cout<<count<<' '<<m.count(2)<<'\n';
 std::cout<<m.erase(2)<<' '<<m.size()<<'\n';
 std::multiset<int> s{1,1,2};std::multiset<int>::iterator it=s.find(1);
 if(it!=s.end())s.erase(it);
 std::cout<<s.size()<<' '<<s.count(1)<<'\n';
}
